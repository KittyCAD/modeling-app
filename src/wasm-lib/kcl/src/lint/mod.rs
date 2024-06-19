mod ast_node;
mod ast_walk;
pub mod checks;
pub mod rule;

pub use ast_node::Node;
pub use ast_walk::walk;
// pub(crate) use rule::{def_finding, finding};
pub use rule::{Discovered, Finding};
