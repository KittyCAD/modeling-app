use serde::Deserialize;
use serde::Serialize;

use super::BoxNode;
use super::ConstraintLevel;
use super::Digest;
use super::Expr;
use super::Node;
use super::NodeList;
use crate::SourceRange;

// TODO: This should be its own type, similar to Program,
// but guaranteed to have an Expression as its final item.
// https://github.com/KittyCAD/modeling-app/issues/4015
type IfBlock = crate::parsing::ast::types::Program;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct IfExpression {
    pub cond: Box<Expr>,
    pub then_val: BoxNode<IfBlock>,
    pub else_ifs: NodeList<ElseIf>,
    pub final_else: BoxNode<IfBlock>,

    pub digest: Option<Digest>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    /// Rename all identifiers that have the old name to the new given name. Branches execute
    /// in the current environment, so their bindings leak; since only one branch runs, each
    /// branch is renamed independently of the others, but a binding in any branch
    /// conservatively stops renaming after the if expression. Conditions evaluate in order
    /// until one is true, so a binding in one stops everything after it.
    pub fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        if self.cond.rename_identifiers(old_name, new_name) {
            return true;
        }
        let mut bound = self.then_val.rename_identifiers(old_name, new_name);
        for else_if in &mut self.else_ifs {
            if else_if.cond.rename_identifiers(old_name, new_name) {
                return true;
            }
            bound |= else_if.then_val.rename_identifiers(old_name, new_name);
        }
        bound |= self.final_else.rename_identifiers(old_name, new_name);
        bound
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.cond.replace_value(source_range, new_value.clone());
        for else_if in &mut self.else_ifs {
            else_if.cond.replace_value(source_range, new_value.clone());
        }
    }
}
