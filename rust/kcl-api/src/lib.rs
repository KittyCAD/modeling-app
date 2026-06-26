pub use artifact_id::ArtifactId;
pub use ast::node_path::NodePath;
pub use ast::node_path::Step;
pub use cad_op::*;
pub use front::*;
use indexmap::IndexMap;
use kcl_error::ModuleId;
pub use numeric_type::*;
use serde::Serialize;
pub use units::*;

mod artifact_id;
pub mod ast;
mod cad_op;
mod front;
mod numeric_type;
mod units;

#[derive(Debug, Clone, Serialize, ts_rs::TS, PartialEq, Default)]
#[ts(export)]
pub struct OperationsByModule {
    pub map: IndexMap<ModuleId, Vec<Operation>>,
}
