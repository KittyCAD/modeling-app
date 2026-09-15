pub use artifact::*;
pub use artifact_id::ArtifactId;
pub use ast::node_path::NodePath;
pub use ast::node_path::Step;
pub use cad_op::*;
pub use front::*;
use indexmap::IndexMap;
use kcl_error::ModuleId;
pub use kcl_value_view::*;
pub use kcl_version::*;
pub use numeric_type::*;
use serde::Serialize;
pub use units::*;

pub mod artifact;
mod artifact_id;
pub mod ast;
mod cad_op;
mod front;
pub mod kcl_value_view;
mod kcl_version;
mod numeric_type;
pub mod point;
mod units;

#[derive(Debug, Clone, Serialize, ts_rs::TS, PartialEq, Default)]
#[ts(export)]
pub struct OperationsByModule {
    pub map: IndexMap<ModuleId, Vec<Operation>>,
}
