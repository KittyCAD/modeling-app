//! Compose typed extension contracts and manage the resources that supply them.

mod contract;
mod factory;
mod planner;
mod plugins;
mod registry;
mod service;
mod signal;

pub use contract::{
    Binding, BindingOptions, ContributionInfo, Facet, Precedence, Resolution, Service,
    ServiceResolutionError, Snapshot, Source,
};
pub use factory::{
    Dependencies, Extension, Factory, HookError, HookResult, Instance, Scope, ScopedSlot, slot,
};
pub use planner::{ItemKind, PlannedItem, plan};
pub use plugins::{
    PluginActivity, PluginController, PluginRecord, PluginSpec, Plugins, create_plugin,
};
pub use registry::{
    HookFailure, HookPhase, InspectedItem, ItemPath, Observation, ObservationError, Origin,
    PathStep, Registry, RegistryError, RegistryInspection,
};
pub use service::{ServiceCallError, ServiceHandle};
pub use signal::{ReadSignal, Signal, Subscription};
