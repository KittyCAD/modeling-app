use std::{
    any::{Any, TypeId},
    collections::HashMap,
    error::Error,
    future::{Future, ready},
    marker::PhantomData,
    pin::Pin,
    rc::{Rc, Weak},
};

use crate::{
    Binding, Facet, Observation, Origin, Registry, RegistryError, Resolution, Service,
    contract::Providers, registry::Published,
};

pub type HookError = Box<dyn Error>;
pub type HookResult<T = ()> = Result<T, HookError>;
type CleanupFuture = Pin<Box<dyn Future<Output = HookResult>>>;
pub(crate) type Cleanup = Box<dyn FnOnce() -> CleanupFuture>;
pub(crate) type Start = Box<dyn FnOnce() -> HookResult<Option<Cleanup>>>;

/// The exports and lifecycle work for one acquired Factory.
pub struct Instance<T> {
    pub(crate) exports: T,
    pub(crate) children: Vec<Extension>,
    pub(crate) start: Option<Start>,
    pub(crate) dispose: Option<Cleanup>,
}

impl<T> Instance<T> {
    pub fn new(exports: T) -> Self {
        Self {
            exports,
            children: Vec::new(),
            start: None,
            dispose: None,
        }
    }

    pub fn with_children(mut self, children: Vec<Extension>) -> Self {
        self.children = children;
        self
    }

    pub fn on_start(mut self, start: impl FnOnce() -> HookResult + 'static) -> Self {
        self.start = Some(Box::new(|| start().map(|()| None)));
        self
    }

    pub fn on_start_with_cleanup<C: FnOnce() -> HookResult + 'static>(
        self,
        start: impl FnOnce() -> HookResult<C> + 'static,
    ) -> Self {
        self.on_start_with_async_cleanup(move || start().map(|stop| move || ready(stop())))
    }

    /// Start synchronously and return a cleanup callback that the registry awaits.
    pub fn on_start_with_async_cleanup<C, F>(
        mut self,
        start: impl FnOnce() -> HookResult<C> + 'static,
    ) -> Self
    where
        C: FnOnce() -> F + 'static,
        F: Future<Output = HookResult> + 'static,
    {
        self.start = Some(Box::new(move || {
            start().map(|stop| Some(erase_cleanup(stop)))
        }));
        self
    }

    pub fn on_dispose(self, dispose: impl FnOnce() -> HookResult + 'static) -> Self {
        self.on_dispose_async(move || ready(dispose()))
    }

    /// Run asynchronous cleanup after any cleanup returned by startup.
    pub fn on_dispose_async<F>(mut self, dispose: impl FnOnce() -> F + 'static) -> Self
    where
        F: Future<Output = HookResult> + 'static,
    {
        self.dispose = Some(erase_cleanup(dispose));
        self
    }
}

fn erase_cleanup<F>(cleanup: impl FnOnce() -> F + 'static) -> Cleanup
where
    F: Future<Output = HookResult> + 'static,
{
    Box::new(move || Box::pin(cleanup()))
}

/// Constructor access to provenance, observations, and owned slots.
/// Observations can be captured during creation and first read after publication.
pub struct Scope {
    pub origin: Origin,
    pub(crate) published: Weak<Published>,
    pub(crate) owner: FactoryKey,
    pub(crate) lifetime: Weak<()>,
}

impl Scope {
    /// Create a slot and an owned handle that can replace its contents.
    /// Include the returned extension among this instance's children.
    pub fn slot(&self, children: Vec<Extension>) -> (Extension, ScopedSlot) {
        let factory = slot(children);
        let extension = factory.clone().into();
        let handle = ScopedSlot {
            published: self.published.clone(),
            owner: self.owner.clone(),
            lifetime: self.lifetime.clone(),
            target: Rc::downgrade(&factory.item.0),
        };
        (extension, handle)
    }

    pub fn observe<F: Facet>(&self) -> Observation<F::Output> {
        Observation::for_facet::<F>(self.published.clone())
    }

    pub fn observe_service<S: Service>(&self) -> Observation<Resolution<S::Capability>> {
        Observation::for_facet::<Providers<S>>(self.published.clone())
    }
}

/// Replacement access to a slot installed by one acquired instance.
#[derive(Clone)]
pub struct ScopedSlot {
    pub(crate) published: Weak<Published>,
    pub(crate) owner: FactoryKey,
    pub(crate) lifetime: Weak<()>,
    pub(crate) target: Weak<Definition>,
}

impl ScopedSlot {
    /// Replace the slot's children using the Registry that acquired its owner.
    pub async fn replace(
        &self,
        registry: &mut Registry,
        children: Vec<Extension>,
    ) -> Result<(), RegistryError> {
        registry.replace_scoped(self, children).await
    }
}

/// A binding, a factory, or a static group of extensions.
#[derive(Clone)]
pub struct Extension(pub(crate) ExtensionKind);

impl Extension {
    pub(crate) fn contains_direct_factory(&self, key: &FactoryKey) -> bool {
        match &self.0 {
            ExtensionKind::Factory(factory) => factory.key() == *key,
            ExtensionKind::Group(items) => {
                items.iter().any(|item| item.contains_direct_factory(key))
            }
            ExtensionKind::Binding(_) => false,
        }
    }
}

#[derive(Clone)]
pub(crate) enum ExtensionKind {
    Binding(Binding),
    Factory(FactoryItem),
    Group(Rc<[Extension]>),
}

impl From<Binding> for Extension {
    fn from(binding: Binding) -> Self {
        Self(ExtensionKind::Binding(binding))
    }
}

impl From<Vec<Extension>> for Extension {
    fn from(items: Vec<Extension>) -> Self {
        Self(ExtensionKind::Group(items.into()))
    }
}

impl<T> From<Factory<T>> for Extension {
    fn from(factory: Factory<T>) -> Self {
        Self(ExtensionKind::Factory(factory.item))
    }
}

#[derive(Clone)]
pub(crate) struct FactoryItem(pub(crate) Rc<Definition>);

impl FactoryItem {
    pub(crate) fn key(&self) -> FactoryKey {
        match &self.0.key {
            Some(name) => FactoryKey::Named(name.clone()),
            None => FactoryKey::Definition(Rc::as_ptr(&self.0) as usize),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum FactoryKey {
    Named(Rc<str>),
    Definition(usize),
}

#[derive(Clone)]
pub(crate) struct Edge {
    pub(crate) name: Rc<str>,
    pub(crate) item: FactoryItem,
}

type Exports = HashMap<FactoryKey, Rc<dyn Any>>;
type Inject<D> = dyn Fn(&Exports) -> Result<D, RegistryError>;
type Create = dyn Fn(&Exports, Scope) -> Result<Instance<Rc<dyn Any>>, RegistryError>;

pub(crate) struct Definition {
    pub(crate) key: Option<Rc<str>>,
    pub(crate) exports: TypeId,
    pub(crate) edges: Vec<Edge>,
    pub(crate) create: Box<Create>,
}

/// A typed Factory handle. Each Registry acquires an instance per reachable
/// identity and injects its exports as owned `Rc<T>` handles.
pub struct Factory<T> {
    pub(crate) item: FactoryItem,
    exports: PhantomData<fn(T) -> T>,
}

impl<T> Clone for Factory<T> {
    fn clone(&self) -> Self {
        Self {
            item: self.item.clone(),
            exports: PhantomData,
        }
    }
}

impl<T: 'static> Factory<T> {
    pub fn new<D: 'static>(
        dependencies: Dependencies<D>,
        create: impl Fn(D, Scope) -> HookResult<Instance<T>> + 'static,
    ) -> Self {
        Self::define(None, dependencies, create)
    }

    pub fn keyed<D: 'static>(
        key: impl Into<Rc<str>>,
        dependencies: Dependencies<D>,
        create: impl Fn(D, Scope) -> HookResult<Instance<T>> + 'static,
    ) -> Self {
        Self::define(Some(key.into()), dependencies, create)
    }

    /// Declare a constructor dependency whose export type comes from this handle.
    ///
    /// ```compile_fail
    /// use std::rc::Rc;
    /// use plankton_rust::{Dependencies, Factory, Instance};
    ///
    /// let files = Factory::new(Dependencies::none(), |(), _| {
    ///     Ok(Instance::new(String::from("document.kcl")))
    /// });
    /// Factory::new(files.dependency("files"), |files: Rc<u32>, _| {
    ///     Ok(Instance::new(*files))
    /// });
    /// ```
    pub fn dependency(&self, name: impl Into<Rc<str>>) -> Dependencies<Rc<T>> {
        let key = self.item.key();
        let name = name.into();
        Dependencies {
            edges: vec![Edge {
                name: name.clone(),
                item: self.item.clone(),
            }],
            inject: Box::new(move |exports| {
                exports
                    .get(&key)
                    .cloned()
                    .and_then(|value| value.downcast::<T>().ok())
                    .ok_or_else(|| RegistryError::DependencyMismatch(name.to_string()))
            }),
        }
    }

    fn define<D: 'static>(
        key: Option<Rc<str>>,
        dependencies: Dependencies<D>,
        create: impl Fn(D, Scope) -> HookResult<Instance<T>> + 'static,
    ) -> Self {
        let Dependencies { edges, inject } = dependencies;
        Self {
            item: FactoryItem(Rc::new(Definition {
                key,
                edges,
                exports: TypeId::of::<T>(),
                create: Box::new(move |exports, scope| {
                    let inputs = inject(exports)?;
                    let origin = scope.origin.clone();
                    let instance = create(inputs, scope)
                        .map_err(|source| RegistryError::Create { origin, source })?;
                    Ok(Instance {
                        exports: Rc::new(instance.exports),
                        children: instance.children,
                        start: instance.start,
                        dispose: instance.dispose,
                    })
                }),
            })),
            exports: PhantomData,
        }
    }
}

/// Declared dependency edges and the typed inputs they supply to a constructor.
pub struct Dependencies<D> {
    edges: Vec<Edge>,
    inject: Box<Inject<D>>,
}

impl Dependencies<()> {
    pub fn none() -> Self {
        Self {
            edges: Vec::new(),
            inject: Box::new(|_| Ok(())),
        }
    }
}

impl<D: 'static> Dependencies<D> {
    pub fn zip<E: 'static>(self, other: Dependencies<E>) -> Dependencies<(D, E)> {
        let mut edges = self.edges;
        edges.extend(other.edges);
        let (left, right) = (self.inject, other.inject);
        Dependencies {
            edges,
            inject: Box::new(move |exports| Ok((left(exports)?, right(exports)?))),
        }
    }

    pub fn map<E: 'static>(self, map: impl Fn(D) -> E + 'static) -> Dependencies<E> {
        let inject = self.inject;
        Dependencies {
            edges: self.edges,
            inject: Box::new(move |exports| Ok(map(inject(exports)?))),
        }
    }
}

/// A Factory whose children can be replaced while it remains mounted.
pub fn slot(children: Vec<Extension>) -> Factory<()> {
    Factory::new(Dependencies::none(), move |(), _| {
        Ok(Instance::new(()).with_children(children.clone()))
    })
}
