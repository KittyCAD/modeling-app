use std::{
    any::{Any, TypeId, type_name},
    collections::{HashMap, HashSet},
    fmt,
    marker::PhantomData,
    rc::Rc,
};

use crate::{
    Origin, ReadSignal, RegistryInspection, ServiceHandle, service::FacetEvaluation,
    signal::Notifier,
};

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

/// A value read by a binding each time its Facet is evaluated.
pub trait Source<T>: Fn() -> T {}

impl<T, F: Fn() -> T + ?Sized> Source<T> for F {}

#[derive(Debug)]
pub enum Resolution<T: ?Sized> {
    Missing,
    Ready(ServiceHandle<T>),
    Conflict(Vec<Origin>),
}

/// A service lookup failed because a provider is absent or several providers conflict.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceResolutionError {
    Missing {
        service: &'static str,
    },
    Conflict {
        service: &'static str,
        providers: Vec<Origin>,
    },
}

impl fmt::Display for ServiceResolutionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing { service } => write!(f, "{service} has no provider"),
            Self::Conflict { service, providers } => {
                write!(f, "{service} has conflicting providers")?;
                for origin in providers {
                    write!(f, " [{}, {}]", origin.name, origin.path)?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for ServiceResolutionError {}

type Install = dyn Fn(&Binding, &mut Snapshot, ContributionInfo);

/// Cloning a binding preserves its graph identity. Creating another binding
/// contributes independently unless the two share a contribution key.
#[derive(Clone)]
pub struct Binding {
    pub(crate) options: Rc<BindingOptions>,
    pub(crate) install: Rc<Install>,
    signals: Vec<Rc<Notifier>>,
}

impl Binding {
    pub(crate) fn identity(&self) -> usize {
        Rc::as_ptr(&self.options) as usize
    }

    pub fn new<F: Facet>(source: impl Source<F::Input> + 'static) -> Self {
        Self::with_options::<F>(source, BindingOptions::default())
    }

    pub fn with_options<F: Facet>(
        source: impl Source<F::Input> + 'static,
        options: BindingOptions,
    ) -> Self {
        Self::for_facet::<F>(move |_| source(), options)
    }

    /// Invalidate this binding's Facet when the signal is written.
    /// The source reads the signal explicitly when it needs the value.
    pub fn depending_on<T>(mut self, signal: &ReadSignal<T>) -> Self {
        let notifier = signal.notifier();
        if !self.signals.iter().any(|other| Rc::ptr_eq(notifier, other)) {
            self.signals.push(notifier.clone());
            // Adding a dependency creates a distinct binding, even after cloning.
            self.options = Rc::new((*self.options).clone());
        }
        self
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
            install: Rc::new(move |binding, snapshot, info| {
                snapshot.insert::<F>(binding, info, read.clone());
            }),
            signals: Vec::new(),
        }
    }
}

pub(crate) struct Providers<S>(PhantomData<S>);

impl<S: Service> Facet for Providers<S> {
    type Input = (Origin, Rc<S::Capability>);
    type Output = Resolution<S::Capability>;

    fn combine(mut inputs: Vec<Self::Input>) -> Self::Output {
        match inputs.len() {
            0 => Resolution::Missing,
            1 => Resolution::Ready(ServiceHandle::new(inputs.swap_remove(0).1)),
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

#[derive(Default)]
struct EffectiveBindings(Vec<(Rc<BindingOptions>, ContributionInfo)>);

impl PartialEq for EffectiveBindings {
    fn eq(&self, other: &Self) -> bool {
        self.0.len() == other.0.len()
            && self
                .0
                .iter()
                .zip(&other.0)
                .all(|((left, left_info), (right, right_info))| {
                    Rc::ptr_eq(left, right) && left_info == right_info
                })
    }
}

pub(crate) struct SignalDependents {
    pub(crate) signal: Rc<Notifier>,
    pub(crate) facets: HashSet<TypeId>,
}

/// One published graph's effective sources. Reads evaluate the sources on
/// demand, so application state captured by those sources can still change.
#[derive(Default)]
pub struct Snapshot {
    pub(crate) inspection: RegistryInspection,
    facets: HashMap<TypeId, Box<dyn Any>>,
    effective: HashMap<TypeId, EffectiveBindings>,
    pub(crate) signal_dependents: HashMap<*const Notifier, SignalDependents>,
}

impl Snapshot {
    /// Inspect the graph captured by this snapshot without evaluating sources.
    pub fn inspect(&self) -> &RegistryInspection {
        &self.inspection
    }

    pub(crate) fn facet_count(&self) -> usize {
        self.facets.len()
    }

    pub fn get<F: Facet>(&self) -> F::Output {
        let _evaluation = FacetEvaluation::enter();
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

    /// Resolve a service and require exactly one provider.
    pub fn required<S: Service>(
        &self,
    ) -> Result<ServiceHandle<S::Capability>, ServiceResolutionError> {
        self.optional::<S>()?
            .ok_or(ServiceResolutionError::Missing {
                service: type_name::<S>(),
            })
    }

    /// Resolve a service while permitting an empty provider list.
    pub fn optional<S: Service>(
        &self,
    ) -> Result<Option<ServiceHandle<S::Capability>>, ServiceResolutionError> {
        match self.resolve::<S>() {
            Resolution::Missing => Ok(None),
            Resolution::Ready(capability) => Ok(Some(capability)),
            Resolution::Conflict(providers) => Err(ServiceResolutionError::Conflict {
                service: type_name::<S>(),
                providers,
            }),
        }
    }

    pub fn debug<F: Facet>(&self) -> impl Iterator<Item = &ContributionInfo> {
        self.entries::<F>().iter().map(|entry| &entry.info)
    }

    pub(crate) fn changed_facets<'a>(
        &'a self,
        previous: &'a Self,
    ) -> impl Iterator<Item = TypeId> + 'a {
        self.effective
            .keys()
            .chain(
                previous
                    .effective
                    .keys()
                    .filter(|key| !self.effective.contains_key(key)),
            )
            .copied()
            .filter(move |key| self.effective.get(key) != previous.effective.get(key))
    }

    fn insert<F: Facet>(
        &mut self,
        binding: &Binding,
        info: ContributionInfo,
        read: Rc<Read<F::Input>>,
    ) {
        let facet = TypeId::of::<F>();
        let contributions = self
            .facets
            .entry(facet)
            .or_insert_with(|| Box::<Contributions<F::Input>>::default())
            .downcast_mut::<Contributions<F::Input>>()
            .expect("a Facet marker uniquely determines its input type");
        if let Some(key) = &info.key
            && !contributions.keys.insert(key.clone())
        {
            return;
        }
        self.effective
            .entry(facet)
            .or_default()
            .0
            .push((binding.options.clone(), info.clone()));
        for signal in &binding.signals {
            self.signal_dependents
                .entry(Rc::as_ptr(signal))
                .or_insert_with(|| SignalDependents {
                    signal: signal.clone(),
                    facets: HashSet::new(),
                })
                .facets
                .insert(facet);
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
