use crate::executor::Metadata;
use crate::executor::SourceRange;

use super::impl_value_meta;
use super::ConstraintLevel;
use super::Hover;
use super::{Digest, Expr};
use databake::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// TODO: This should be its own type, similar to Program,
// but guaranteed to have an Expression as its final item.
// https://github.com/KittyCAD/modeling-app/issues/4015
type IfBlock = crate::ast::types::Program;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct IfExpression {
    pub start: usize,
    pub end: usize,
    pub cond: Box<Expr>,
    pub then_val: Box<IfBlock>,
    pub else_ifs: Vec<ElseIf>,
    pub final_else: Box<IfBlock>,

    pub digest: Option<Digest>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ElseIf {
    pub start: usize,
    pub end: usize,
    pub cond: Expr,
    pub then_val: Box<IfBlock>,

    pub digest: Option<Digest>,
}

// Source code metadata

impl_value_meta!(IfExpression);
impl_value_meta!(ElseIf);

impl IfExpression {
    fn source_ranges(&self) -> Vec<SourceRange> {
        vec![SourceRange::from(self)]
    }
}

impl From<IfExpression> for Metadata {
    fn from(value: IfExpression) -> Self {
        Self {
            source_range: value.into(),
        }
    }
}

impl From<ElseIf> for Metadata {
    fn from(value: ElseIf) -> Self {
        Self {
            source_range: value.into(),
        }
    }
}
impl From<&IfExpression> for Metadata {
    fn from(value: &IfExpression) -> Self {
        Self {
            source_range: value.into(),
        }
    }
}

impl From<&ElseIf> for Metadata {
    fn from(value: &ElseIf) -> Self {
        Self {
            source_range: value.into(),
        }
    }
}

impl ElseIf {
    #[allow(dead_code)]
    fn source_ranges(&self) -> Vec<SourceRange> {
        vec![SourceRange([self.start, self.end])]
    }
}

// IDE support and refactors

impl IfExpression {
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        self.cond
            .get_hover_value_for_position(pos, code)
            .or_else(|| self.then_val.get_hover_value_for_position(pos, code))
            .or_else(|| {
                self.else_ifs
                    .iter()
                    .find_map(|else_if| else_if.get_hover_value_for_position(pos, code))
            })
            .or_else(|| self.final_else.get_hover_value_for_position(pos, code))
    }

    /// Rename all identifiers that have the old name to the new given name.
    pub fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.cond.rename_identifiers(old_name, new_name);
        self.then_val.rename_identifiers(old_name, new_name);
        for else_if in &mut self.else_ifs {
            else_if.rename_identifiers(old_name, new_name);
        }
        self.final_else.rename_identifiers(old_name, new_name);
    }
    /// Get the constraint level.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Full {
            source_ranges: self.source_ranges(),
        }
    }
    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.cond.replace_value(source_range, new_value.clone());
        for else_if in &mut self.else_ifs {
            else_if.cond.replace_value(source_range, new_value.clone());
        }
    }
}

impl ElseIf {
    fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        self.cond
            .get_hover_value_for_position(pos, code)
            .or_else(|| self.then_val.get_hover_value_for_position(pos, code))
    }
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.cond.rename_identifiers(old_name, new_name);
        self.then_val.rename_identifiers(old_name, new_name);
    }
}
