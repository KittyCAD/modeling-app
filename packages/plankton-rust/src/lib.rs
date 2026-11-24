//! Compose typed extension contracts and manage the resources that supply them.

mod contract;
mod factory;
mod planner;
mod registry;

pub use contract::{
    Binding, BindingOptions, ContributionInfo, Facet, Precedence, Resolution, Service, Snapshot,
};
pub use factory::{Dependencies, Extension, Factory, HookError, HookResult, Instance, Scope, slot};
pub use registry::{
    HookFailure, HookPhase, ItemPath, Observation, ObservationError, Origin, PathStep, Registry,
    RegistryError,
};
