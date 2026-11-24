use std::{
    any::{Any, TypeId},
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    error::Error,
    fmt,
    rc::{Rc, Weak},
};

use crate::{
    Binding, ContributionInfo, Extension, Facet, Factory, HookError, Resolution, Scope, ScopedSlot,
    Service, ServiceResolutionError, Snapshot, Subscription,
    contract::Providers,
    factory::{Cleanup, ExtensionKind, FactoryItem, FactoryKey, Start},
    planner::{Planned, cycle, plan},
    signal::Notifier,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    pub name: String,
    pub path: ItemPath,
}

/// An occurrence in the configuration, used to explain selection and failures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemPath {
    pub root: usize,
    pub steps: Vec<PathStep>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathStep {
    Child(usize),
    Dependency(Rc<str>),
}

impl ItemPath {
    pub(crate) fn at(&self, step: PathStep) -> Self {
        let mut path = self.clone();
        path.steps.push(step);
        path
    }
}

impl fmt::Display for ItemPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}]", self.root)?;
        for step in &self.steps {
            match step {
                PathStep::Child(index) => write!(f, ".items[{index}]")?,
                PathStep::Dependency(name) => write!(f, ".dependencies[{name:?}]")?,
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookPhase {
    Start,
    Stop,
    Dispose,
}

#[derive(Debug)]
pub struct HookFailure {
    pub origin: Origin,
    pub phase: HookPhase,
    pub source: HookError,
}

#[derive(Debug)]
pub enum RegistryError {
    Disposed,
    Unmounted,
    WrongRegistry,
    ScopeExpired,
    SlotNotOwned,
    DependencyMismatch(String),
    RetainedFactoryChanged(Origin),
    DependencyCycle(Vec<ItemPath>),
    LifetimeCycle(Vec<Origin>),
    Create {
        origin: Origin,
        source: HookError,
    },
    Rollback {
        cause: Box<Self>,
        failures: Vec<HookFailure>,
    },
    Settling(Vec<HookFailure>),
}

impl fmt::Display for RegistryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Disposed => f.write_str("registry is disposed"),
            Self::Unmounted => f.write_str("factory is not mounted"),
            Self::WrongRegistry => {
                f.write_str("the selected registry did not acquire this scoped slot")
            }
            Self::ScopeExpired => {
                f.write_str("the scoped slot's owning instance is no longer mounted")
            }
            Self::SlotNotOwned => {
                f.write_str("the scoped slot is not installed among its owner's children")
            }
            Self::DependencyMismatch(name) => {
                write!(f, "dependency {name:?} does not match the selected factory")
            }
            Self::RetainedFactoryChanged(origin) => write!(
                f,
                "retained factory {:?} changed its export type or dependencies",
                origin.name
            ),
            Self::DependencyCycle(paths) => {
                f.write_str("cyclic extension dependency")?;
                for path in paths {
                    write!(f, " -> {path}")?;
                }
                Ok(())
            }
            Self::LifetimeCycle(origins) => {
                f.write_str("cyclic factory lifetimes")?;
                for origin in origins {
                    write!(f, " -> {}", origin.name)?;
                }
                Ok(())
            }
            Self::Create { origin, source } => write!(
                f,
                "creating {:?} at {} failed: {source}",
                origin.name, origin.path
            ),
            Self::Rollback { cause, failures } => {
                write!(f, "{cause} ({} rollback hook failures)", failures.len())
            }
            Self::Settling(failures) => write!(
                f,
                "{} lifecycle hook failures after publication",
                failures.len()
            ),
        }
    }
}

impl Error for RegistryError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Create { source, .. } => Some(source.as_ref()),
            Self::Rollback { cause, .. } => Some(cause),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObservationError {
    Acquiring,
    RegistryDropped,
}

impl fmt::Display for ObservationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Acquiring => "defer live observation reads until acquisition completes",
            Self::RegistryDropped => "the observed registry has been dropped",
        })
    }
}

impl Error for ObservationError {}

/// Owns the active signal connections and batches invalidation through reconciliation.
#[derive(Default)]
pub(crate) struct Published {
    snapshot: RefCell<Rc<Snapshot>>,
    acquiring: Cell<bool>,
    reconciling: Cell<bool>,
    notifying: Cell<bool>,
    observers: RefCell<HashMap<TypeId, Rc<Notifier>>>,
    signal_connections: RefCell<Vec<Subscription>>,
    dirty: RefCell<HashSet<TypeId>>,
}

impl Published {
    fn snapshot_for_observation(&self) -> Result<Rc<Snapshot>, ObservationError> {
        if self.acquiring.get() {
            return Err(ObservationError::Acquiring);
        }
        Ok(self.snapshot.borrow().clone())
    }

    fn publish(self: &Rc<Self>, snapshot: Snapshot) {
        let connections = snapshot
            .signal_dependents
            .values()
            .map(|dependents| {
                let published = Rc::downgrade(self);
                let facets = dependents.facets.clone();
                dependents.signal.subscribe(move || {
                    if let Some(published) = published.upgrade() {
                        published.invalidate(facets.iter().copied());
                    }
                })
            })
            .collect();
        let snapshot = Rc::new(snapshot);
        let previous = self.snapshot.replace(snapshot.clone());
        drop(self.signal_connections.replace(connections));
        self.invalidate(snapshot.changed_facets(&previous));
    }

    fn invalidate(&self, facets: impl IntoIterator<Item = TypeId>) {
        self.dirty.borrow_mut().extend(facets);
        self.flush();
    }

    fn flush(&self) {
        if self.reconciling.get() || self.notifying.get() {
            return;
        }
        let _notifying = ActiveFlag::begin(&self.notifying);
        loop {
            let facets = std::mem::take(&mut *self.dirty.borrow_mut());
            if facets.is_empty() {
                break;
            }
            for facet in facets {
                let observers = self.observers.borrow().get(&facet).cloned();
                if let Some(observers) = observers {
                    observers.notify();
                }
            }
        }
    }
}

/// A live, owned handle. Reading it samples the current published graph.
pub struct Observation<T> {
    published: Weak<Published>,
    facet: TypeId,
    read: fn(&Snapshot) -> T,
}

impl<T> Clone for Observation<T> {
    fn clone(&self) -> Self {
        Self {
            published: self.published.clone(),
            facet: self.facet,
            read: self.read,
        }
    }
}

impl<T> Observation<T> {
    pub(crate) fn for_facet<F: Facet<Output = T>>(published: Weak<Published>) -> Self {
        Self {
            published,
            facet: TypeId::of::<F>(),
            read: Snapshot::get::<F>,
        }
    }

    pub fn get(&self) -> Result<T, ObservationError> {
        let published = self
            .published
            .upgrade()
            .ok_or(ObservationError::RegistryDropped)?;
        let snapshot = published.snapshot_for_observation()?;
        Ok((self.read)(&snapshot))
    }

    /// Read the latest output on each invalidation until the returned guard drops.
    /// Registration does not invoke the listener. Pending invalidations are
    /// delivered synchronously after reconciliation, including to new subscribers.
    pub fn subscribe(
        &self,
        listener: impl Fn(T) + 'static,
    ) -> Result<Subscription, ObservationError>
    where
        T: 'static,
    {
        let published = self
            .published
            .upgrade()
            .ok_or(ObservationError::RegistryDropped)?;
        published.snapshot_for_observation()?;
        let observers = published
            .observers
            .borrow_mut()
            .entry(self.facet)
            .or_default()
            .clone();
        let observation = self.clone();
        Ok(observers.subscribe(move || {
            if let Ok(value) = observation.get() {
                listener(value);
            }
        }))
    }
}

struct ActiveFlag<'a>(&'a Cell<bool>);

impl<'a> ActiveFlag<'a> {
    fn begin(flag: &'a Cell<bool>) -> Self {
        flag.set(true);
        Self(flag)
    }
}

impl Drop for ActiveFlag<'_> {
    fn drop(&mut self) {
        self.0.set(false);
    }
}

#[derive(Clone)]
struct Mounted {
    instance: Rc<RuntimeInstance>,
    children: Vec<Extension>,
}

struct RuntimeInstance {
    lifetime: Rc<()>,
    definition: FactoryItem,
    dependencies: Vec<Rc<RuntimeInstance>>,
    exports: Rc<dyn Any>,
    origin: Origin,
    hooks: RefCell<Hooks>,
}

struct Hooks {
    start: Option<Start>,
    stop: Option<Cleanup>,
    dispose: Option<Cleanup>,
}

impl RuntimeInstance {
    fn start(&self, failures: &mut Vec<HookFailure>) {
        let start = self.hooks.borrow_mut().start.take();
        if let Some(start) = start {
            match start() {
                Ok(stop) => self.hooks.borrow_mut().stop = stop,
                Err(source) => failures.push(self.failure(HookPhase::Start, source)),
            }
        }
    }

    fn release(&self, failures: &mut Vec<HookFailure>) {
        let (stop, dispose) = {
            let mut hooks = self.hooks.borrow_mut();
            (hooks.stop.take(), hooks.dispose.take())
        };
        for (phase, cleanup) in [(HookPhase::Stop, stop), (HookPhase::Dispose, dispose)] {
            if let Some(cleanup) = cleanup
                && let Err(source) = cleanup()
            {
                failures.push(self.failure(phase, source));
            }
        }
    }

    fn failure(&self, phase: HookPhase, source: HookError) -> HookFailure {
        HookFailure {
            origin: self.origin.clone(),
            phase,
            source,
        }
    }
}

/// Owns a published graph and the Factory instances that keep it running.
/// Exclusive mutation serializes reconciliation and its lifecycle hooks.
#[derive(Default)]
pub struct Registry {
    published: Rc<Published>,
    roots: Vec<Extension>,
    mounted: HashMap<FactoryKey, Mounted>,
    disposal: Vec<FactoryKey>,
    disposed: bool,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Capture a graph for consistent reads across multiple Facets.
    pub fn snapshot(&self) -> Rc<Snapshot> {
        self.published.snapshot.borrow().clone()
    }

    pub fn get<F: Facet>(&self) -> F::Output {
        self.snapshot().get::<F>()
    }

    pub fn resolve<S: Service>(&self) -> Resolution<S::Capability> {
        self.snapshot().resolve::<S>()
    }

    pub fn required<S: Service>(&self) -> Result<Rc<S::Capability>, ServiceResolutionError> {
        self.snapshot().required::<S>()
    }

    pub fn optional<S: Service>(
        &self,
    ) -> Result<Option<Rc<S::Capability>>, ServiceResolutionError> {
        self.snapshot().optional::<S>()
    }

    pub fn observe<F: Facet>(&self) -> Observation<F::Output> {
        Observation::for_facet::<F>(Rc::downgrade(&self.published))
    }

    pub fn observe_service<S: Service>(&self) -> Observation<Resolution<S::Capability>> {
        Observation::for_facet::<Providers<S>>(Rc::downgrade(&self.published))
    }

    pub fn configure(&mut self, roots: Vec<Extension>) -> Result<(), RegistryError> {
        self.reconcile(roots, None)
    }

    pub fn replace<T>(
        &mut self,
        owner: &Factory<T>,
        children: Vec<Extension>,
    ) -> Result<(), RegistryError> {
        self.replace_factory(&owner.item, children)
    }

    fn replace_factory(
        &mut self,
        owner: &FactoryItem,
        children: Vec<Extension>,
    ) -> Result<(), RegistryError> {
        if self.disposed {
            return Err(RegistryError::Disposed);
        }
        let key = owner.key();
        let mounted = self.mounted.get(&key).ok_or(RegistryError::Unmounted)?;
        if mounted.instance.definition.0.exports != owner.0.exports {
            return Err(RegistryError::RetainedFactoryChanged(
                mounted.instance.origin.clone(),
            ));
        }
        self.reconcile(self.roots.clone(), Some((key, children)))
    }

    pub(crate) fn replace_scoped(
        &mut self,
        slot: &ScopedSlot,
        children: Vec<Extension>,
    ) -> Result<(), RegistryError> {
        if !Weak::ptr_eq(&slot.published, &Rc::downgrade(&self.published)) {
            return Err(RegistryError::WrongRegistry);
        }
        let owner = self
            .mounted
            .get(&slot.owner)
            .filter(|owner| Weak::ptr_eq(&slot.lifetime, &Rc::downgrade(&owner.instance.lifetime)))
            .ok_or(RegistryError::ScopeExpired)?;
        let target = FactoryItem(slot.target.upgrade().ok_or(RegistryError::SlotNotOwned)?);
        let key = target.key();
        if !owner
            .children
            .iter()
            .any(|item| item.contains_direct_factory(&key))
        {
            return Err(RegistryError::SlotNotOwned);
        }
        self.replace_factory(&target, children)
    }

    pub fn dispose(&mut self) -> Result<(), RegistryError> {
        if self.disposed {
            return Ok(());
        }
        let result = self.configure(Vec::new());
        self.disposed = true;
        result
    }

    fn reconcile(
        &mut self,
        roots: Vec<Extension>,
        replacement: Option<(FactoryKey, Vec<Extension>)>,
    ) -> Result<(), RegistryError> {
        if self.disposed {
            return Err(RegistryError::Disposed);
        }
        let published = self.published.clone();
        let reconciling = ActiveFlag::begin(&published.reconciling);
        let result = self.reconcile_graph(roots, replacement);
        drop(reconciling);
        published.flush();
        result
    }

    fn reconcile_graph(
        &mut self,
        roots: Vec<Extension>,
        replacement: Option<(FactoryKey, Vec<Extension>)>,
    ) -> Result<(), RegistryError> {
        let acquisition = ActiveFlag::begin(&self.published.acquiring);
        let mut draft = Draft {
            replacement,
            ..Draft::default()
        };
        let result = draft
            .acquire(&roots, None, None, self)
            .and_then(|()| draft.disposal_order(true));
        drop(acquisition);
        let disposal = match result {
            Ok(order) => order,
            Err(cause) => return Err(draft.rollback(cause)),
        };

        let snapshot = draft.snapshot();
        self.roots = roots;
        let mut previous = std::mem::replace(&mut self.mounted, draft.mounted);
        let previous_disposal = std::mem::replace(&mut self.disposal, disposal);
        self.published.publish(snapshot);

        let mut failures = Vec::new();
        for key in previous_disposal {
            if !self.mounted.contains_key(&key) {
                let removed = previous
                    .remove(&key)
                    .expect("disposal order tracks mounted instances");
                removed.instance.release(&mut failures);
            }
        }
        for key in draft.created {
            self.mounted[&key].instance.start(&mut failures);
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(RegistryError::Settling(failures))
        }
    }
}

impl Drop for Registry {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            let _ = self.dispose();
        }
    }
}

/// Only a successful draft can replace the published graph. Retained instances
/// are shared with the old graph and never enter the rollback list.
#[derive(Default)]
struct Draft {
    replacement: Option<(FactoryKey, Vec<Extension>)>,
    selected: HashMap<FactoryKey, FactoryItem>,
    mounted: HashMap<FactoryKey, Mounted>,
    exports: HashMap<FactoryKey, Rc<dyn Any>>,
    order: Vec<FactoryKey>,
    created: Vec<FactoryKey>,
    active: Vec<(FactoryKey, ItemPath)>,
    bindings: Vec<(Binding, ContributionInfo)>,
    seen_bindings: HashSet<usize>,
}

impl Draft {
    fn acquire(
        &mut self,
        items: &[Extension],
        parent: Option<&ItemPath>,
        owner: Option<&Origin>,
        registry: &Registry,
    ) -> Result<(), RegistryError> {
        for item in plan(items, parent, &mut self.selected)? {
            match item {
                Planned::Binding(binding, path) => {
                    if self
                        .seen_bindings
                        .insert(Rc::as_ptr(&binding.options) as usize)
                    {
                        let info = ContributionInfo {
                            origin: owner.cloned().unwrap_or_else(|| Origin {
                                name: path.to_string(),
                                path,
                            }),
                            key: binding.options.key.clone(),
                            precedence: binding.options.precedence,
                        };
                        self.bindings.push((binding, info));
                    }
                }
                Planned::Factory(factory, path) => self.mount(factory, path, registry)?,
            }
        }
        Ok(())
    }

    fn mount(
        &mut self,
        factory: FactoryItem,
        path: ItemPath,
        registry: &Registry,
    ) -> Result<(), RegistryError> {
        let key = factory.key();
        if let Some(error) = cycle(&self.active, &key, &path) {
            return Err(error);
        }
        if self.mounted.contains_key(&key) {
            return Ok(());
        }

        let dependencies = factory
            .0
            .edges
            .iter()
            .map(|edge| {
                self.mounted
                    .get(&edge.item.key())
                    .filter(|mounted| Rc::ptr_eq(&mounted.instance.definition.0, &edge.item.0))
                    .map(|mounted| mounted.instance.clone())
                    .ok_or_else(|| RegistryError::DependencyMismatch(edge.name.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;

        let mut mounted = match registry.mounted.get(&key) {
            Some(retained) => {
                let instance = &retained.instance;
                if instance.definition.0.exports != factory.0.exports
                    || instance.dependencies.len() != dependencies.len()
                    || instance
                        .definition
                        .0
                        .edges
                        .iter()
                        .zip(&factory.0.edges)
                        .any(|(old, new)| old.name != new.name)
                    || instance
                        .dependencies
                        .iter()
                        .zip(&dependencies)
                        .any(|(old, new)| !Rc::ptr_eq(old, new))
                {
                    return Err(RegistryError::RetainedFactoryChanged(
                        instance.origin.clone(),
                    ));
                }
                retained.clone()
            }
            None => {
                let origin = Origin {
                    name: factory
                        .0
                        .key
                        .as_deref()
                        .map_or_else(|| path.to_string(), str::to_owned),
                    path: path.clone(),
                };
                let lifetime = Rc::new(());
                let scope = Scope {
                    origin: origin.clone(),
                    published: Rc::downgrade(&registry.published),
                    owner: key.clone(),
                    lifetime: Rc::downgrade(&lifetime),
                };
                let instance = (factory.0.create)(&self.exports, scope)?;
                self.created.push(key.clone());
                Mounted {
                    children: instance.children,
                    instance: Rc::new(RuntimeInstance {
                        lifetime,
                        definition: factory,
                        dependencies,
                        exports: instance.exports,
                        origin,
                        hooks: RefCell::new(Hooks {
                            start: instance.start,
                            stop: None,
                            dispose: instance.dispose,
                        }),
                    }),
                }
            }
        };
        if let Some((owner, children)) = &self.replacement
            && owner == &key
        {
            mounted.children.clone_from(children);
        }
        self.order.push(key.clone());
        self.exports
            .insert(key.clone(), mounted.instance.exports.clone());
        self.mounted.insert(key.clone(), mounted.clone());
        self.active.push((key, path.clone()));
        let result = self.acquire(
            &mounted.children,
            Some(&path),
            Some(&mounted.instance.origin),
            registry,
        );
        self.active.pop();
        result
    }

    fn snapshot(&mut self) -> Snapshot {
        let mut snapshot = Snapshot::default();
        self.bindings.sort_by_key(|(_, info)| info.precedence);
        for (binding, info) in std::mem::take(&mut self.bindings) {
            (binding.install)(&binding, &mut snapshot, info);
        }
        snapshot
    }

    fn rollback(mut self, cause: RegistryError) -> RegistryError {
        self.exports.clear();
        let created: HashSet<_> = self.created.iter().collect();
        let mut failures = Vec::new();
        // Non-strict ordering breaks any cycle so every acquired instance is released.
        if let Ok(order) = self.disposal_order(false) {
            for key in order {
                if created.contains(&key) {
                    let removed = self
                        .mounted
                        .remove(&key)
                        .expect("rollback order tracks acquired instances");
                    removed.instance.release(&mut failures);
                }
            }
        }
        if failures.is_empty() {
            cause
        } else {
            RegistryError::Rollback {
                cause: Box::new(cause),
                failures,
            }
        }
    }

    fn disposal_order(&self, strict: bool) -> Result<Vec<FactoryKey>, RegistryError> {
        let mut before = HashMap::<FactoryKey, Vec<FactoryKey>>::new();
        for key in &self.order {
            let mounted = &self.mounted[key];
            for dependency in &mounted.instance.dependencies {
                before
                    .entry(dependency.definition.key())
                    .or_default()
                    .push(key.clone());
            }
            self.add_children(&mounted.children, before.entry(key.clone()).or_default());
        }
        let mut order = ReleaseOrder {
            draft: self,
            before,
            strict,
            active: Vec::new(),
            complete: HashSet::new(),
            result: Vec::new(),
        };
        for key in self.order.iter().rev() {
            order.visit(key)?;
        }
        Ok(order.result)
    }

    fn add_children(&self, items: &[Extension], before_owner: &mut Vec<FactoryKey>) {
        for item in items {
            match &item.0 {
                ExtensionKind::Factory(factory) => {
                    let key = factory.key();
                    if self.mounted.contains_key(&key)
                        && self
                            .selected
                            .get(&key)
                            .is_some_and(|winner| Rc::ptr_eq(&winner.0, &factory.0))
                    {
                        before_owner.push(key);
                    }
                }
                ExtensionKind::Group(items) => self.add_children(items, before_owner),
                ExtensionKind::Binding(_) => {}
            }
        }
    }
}

struct ReleaseOrder<'a> {
    draft: &'a Draft,
    before: HashMap<FactoryKey, Vec<FactoryKey>>,
    strict: bool,
    active: Vec<FactoryKey>,
    complete: HashSet<FactoryKey>,
    result: Vec<FactoryKey>,
}

impl ReleaseOrder<'_> {
    fn visit(&mut self, key: &FactoryKey) -> Result<(), RegistryError> {
        if self.complete.contains(key) {
            return Ok(());
        }
        if let Some(start) = self.active.iter().position(|ancestor| ancestor == key) {
            if self.strict {
                let origins = self.active[start..]
                    .iter()
                    .chain(std::iter::once(key))
                    .map(|key| self.draft.mounted[key].instance.origin.clone())
                    .collect();
                return Err(RegistryError::LifetimeCycle(origins));
            }
            return Ok(());
        }
        self.active.push(key.clone());
        for earlier in self.before.remove(key).unwrap_or_default() {
            self.visit(&earlier)?;
        }
        self.active.pop();
        self.complete.insert(key.clone());
        self.result.push(key.clone());
        Ok(())
    }
}
