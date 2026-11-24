use std::{
    any::{Any, TypeId},
    collections::{HashMap, HashSet},
    marker::PhantomData,
    rc::Rc,
};

use crate::Origin;

/// A marker type identifies one contract. Its associated types pair the input
/// accepted by a binding with the output returned to readers.
///
/// ```compile_fail
/// use plankton_rust::{Binding, Facet};
///
/// struct Panels;
/// impl Facet for Panels {
///     type Input = String;
///     type Output = Vec<String>;
///     fn combine(inputs: Vec<String>) -> Vec<String> { inputs }
/// }
///
/// Binding::new::<Panels>(|| 42);
/// ```
pub trait Facet: 'static {
    type Input: 'static;
    type Output;

    /// Combine effective contributions in precedence order, including an empty list.
    fn combine(inputs: Vec<Self::Input>) -> Self::Output;
}

/// A marker type names a capability contract. Multiple services can use the
/// same capability type. Trait object capabilities can hide the implementation.
///
/// ```compile_fail
/// use std::rc::Rc;
/// use plankton_rust::{Binding, Service};
///
/// trait FileAccess {}
/// struct Files;
/// impl Service for Files { type Capability = dyn FileAccess; }
///
/// Binding::provide::<Files>(Rc::new(String::new()));
/// ```
pub trait Service: 'static {
    type Capability: ?Sized + 'static;
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum Precedence {
    Highest,
    High,
    #[default]
    Default,
    Low,
    Lowest,
}

#[derive(Debug, Clone, Default)]
pub struct BindingOptions {
    pub key: Option<String>,
    pub precedence: Precedence,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContributionInfo {
    pub origin: Origin,
    pub key: Option<String>,
    pub precedence: Precedence,
}

#[derive(Debug)]
pub enum Resolution<T: ?Sized> {
    Missing,
    Ready(Rc<T>),
    Conflict(Vec<Origin>),
}

type Install = dyn Fn(&mut Snapshot, ContributionInfo);

/// Cloning a binding preserves its graph identity. Creating another binding
/// contributes independently unless the two share a contribution key.
#[derive(Clone)]
pub struct Binding {
    pub(crate) options: Rc<BindingOptions>,
    pub(crate) install: Rc<Install>,
}

impl Binding {
    pub fn new<F: Facet>(source: impl Fn() -> F::Input + 'static) -> Self {
        Self::with_options::<F>(source, BindingOptions::default())
    }

    pub fn with_options<F: Facet>(
        source: impl Fn() -> F::Input + 'static,
        options: BindingOptions,
    ) -> Self {
        Self::for_facet::<F>(move |_| source(), options)
    }

    pub fn provide<S: Service>(capability: Rc<S::Capability>) -> Self {
        Self::provide_with_options::<S>(capability, BindingOptions::default())
    }

    pub fn provide_with_options<S: Service>(
        capability: Rc<S::Capability>,
        options: BindingOptions,
    ) -> Self {
        Self::for_facet::<Providers<S>>(
            move |origin| (origin.clone(), Rc::clone(&capability)),
            options,
        )
    }

    fn for_facet<F: Facet>(
        read: impl Fn(&Origin) -> F::Input + 'static,
        options: BindingOptions,
    ) -> Self {
        let read: Rc<Read<F::Input>> = Rc::new(read);
        Self {
            options: Rc::new(options),
            install: Rc::new(move |snapshot, info| snapshot.insert::<F>(info, read.clone())),
        }
    }
}

struct Providers<S>(PhantomData<S>);

impl<S: Service> Facet for Providers<S> {
    type Input = (Origin, Rc<S::Capability>);
    type Output = Resolution<S::Capability>;

    fn combine(mut inputs: Vec<Self::Input>) -> Self::Output {
        match inputs.len() {
            0 => Resolution::Missing,
            1 => Resolution::Ready(inputs.swap_remove(0).1),
            _ => Resolution::Conflict(inputs.into_iter().map(|(origin, _)| origin).collect()),
        }
    }
}

type Read<I> = dyn Fn(&Origin) -> I;

struct Entry<I> {
    info: ContributionInfo,
    read: Rc<Read<I>>,
}

struct Contributions<I> {
    entries: Vec<Entry<I>>,
    keys: HashSet<String>,
}

impl<I> Default for Contributions<I> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            keys: HashSet::new(),
        }
    }
}

/// One published graph's effective sources. Reads evaluate the sources on
/// demand, so application state captured by those sources can still change.
#[derive(Default)]
pub struct Snapshot {
    facets: HashMap<TypeId, Box<dyn Any>>,
}

impl Snapshot {
    pub fn get<F: Facet>(&self) -> F::Output {
        let entries = self.entries::<F>();
        F::combine(
            entries
                .iter()
                .map(|entry| (entry.read)(&entry.info.origin))
                .collect(),
        )
    }

    pub fn resolve<S: Service>(&self) -> Resolution<S::Capability> {
        self.get::<Providers<S>>()
    }

    pub fn debug<F: Facet>(&self) -> impl Iterator<Item = &ContributionInfo> {
        self.entries::<F>().iter().map(|entry| &entry.info)
    }

    fn insert<F: Facet>(&mut self, info: ContributionInfo, read: Rc<Read<F::Input>>) {
        let contributions = self
            .facets
            .entry(TypeId::of::<F>())
            .or_insert_with(|| Box::<Contributions<F::Input>>::default())
            .downcast_mut::<Contributions<F::Input>>()
            .expect("a Facet marker uniquely determines its input type");
        if let Some(key) = &info.key
            && !contributions.keys.insert(key.clone())
        {
            return;
        }
        contributions.entries.push(Entry { info, read });
    }

    fn entries<F: Facet>(&self) -> &[Entry<F::Input>] {
        self.facets.get(&TypeId::of::<F>()).map_or(&[], |value| {
            &value
                .downcast_ref::<Contributions<F::Input>>()
                .expect("a Facet marker uniquely determines its input type")
                .entries
        })
    }
}
