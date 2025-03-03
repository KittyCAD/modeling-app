use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{BoxNode, ConstraintLevel, Digest, Expr, Node, NodeList};
use crate::SourceRange;

// TODO: This should be its own type, similar to Program,
// but guaranteed to have an Expression as its final item.
// https://github.com/KittyCAD/modeling-app/issues/4015
type IfBlock = crate::parsing::ast::types::Program;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct IfExpression {
    pub cond: Box<Expr>,
    pub then_val: BoxNode<IfBlock>,
    pub else_ifs: NodeList<ElseIf>,
    pub final_else: BoxNode<IfBlock>,

    pub digest: Option<Digest>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ElseIf {
    pub cond: Expr,
    pub then_val: BoxNode<IfBlock>,

    pub digest: Option<Digest>,
}

// Source code metadata

impl Node<IfExpression> {
    fn source_ranges(&self) -> Vec<SourceRange> {
        vec![SourceRange::from(self)]
    }
}

impl Node<ElseIf> {
    #[allow(dead_code)]
    fn source_ranges(&self) -> Vec<SourceRange> {
        vec![SourceRange::new(self.start, self.end, self.module_id)]
    }
}

// IDE support and refactors

impl Node<IfExpression> {
    /// Get the constraint level.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Full {
            source_ranges: self.source_ranges(),
        }
    }
}

impl IfExpression {
    /// Rename all identifiers that have the old name to the new given name.
    pub fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.cond.rename_identifiers(old_name, new_name);
        self.then_val.rename_identifiers(old_name, new_name);
        for else_if in &mut self.else_ifs {
            else_if.rename_identifiers(old_name, new_name);
        }
        self.final_else.rename_identifiers(old_name, new_name);
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.cond.replace_value(source_range, new_value.clone());
        for else_if in &mut self.else_ifs {
            else_if.cond.replace_value(source_range, new_value.clone());
        }
    }
}

impl ElseIf {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.cond.rename_identifiers(old_name, new_name);
        self.then_val.rename_identifiers(old_name, new_name);
    }
}
