//! Compose typed extension contracts and manage the resources that supply them.

mod contract;
mod factory;
mod planner;
mod plugins;
mod registry;
mod signal;

pub use contract::{
    Binding, BindingOptions, ContributionInfo, Facet, Precedence, Resolution, Service,
    ServiceResolutionError, Snapshot, Source,
};
pub use factory::{
    Dependencies, Extension, Factory, HookError, HookResult, Instance, Scope, ScopedSlot, slot,
};
pub use plugins::{PluginController, PluginRecord, PluginSpec, Plugins, create_plugin};
pub use registry::{
    HookFailure, HookPhase, ItemPath, Observation, ObservationError, Origin, PathStep, Registry,
    RegistryError,
};
pub use signal::{ReadSignal, Signal, Subscription};
