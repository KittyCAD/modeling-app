use crate::errors::KclError;
use crate::executor::BodyType;
use crate::executor::ExecState;
use crate::executor::ExecutorContext;
use crate::executor::KclValue;
use crate::executor::Metadata;
use crate::executor::SourceRange;
use crate::executor::StatementKind;

use super::compute_digest;
use super::impl_value_meta;
use super::ConstraintLevel;
use super::Hover;
use super::{Digest, Expr};
use databake::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest as DigestTrait, Sha256};

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
    compute_digest!(|slf, hasher| {
        hasher.update(slf.cond.compute_digest());
        hasher.update(slf.then_val.compute_digest());
        for else_if in &mut slf.else_ifs {
            hasher.update(else_if.compute_digest());
        }
        hasher.update(slf.final_else.compute_digest());
    });
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
    compute_digest!(|slf, hasher| {
        hasher.update(slf.cond.compute_digest());
        hasher.update(slf.then_val.compute_digest());
    });
    #[allow(dead_code)]
    fn source_ranges(&self) -> Vec<SourceRange> {
        vec![SourceRange([self.start, self.end])]
    }
}

// Execution

impl IfExpression {
    #[async_recursion::async_recursion]
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        // Check the `if` branch.
        let cond = ctx
            .execute_expr(&self.cond, exec_state, &Metadata::from(self), StatementKind::Expression)
            .await?
            .get_bool()?;
        if cond {
            let block_result = ctx.inner_execute(&self.then_val, exec_state, BodyType::Block).await?;
            // Block must end in an expression, so this has to be Some.
            // Enforced by the parser.
            // See https://github.com/KittyCAD/modeling-app/issues/4015
            return Ok(block_result.unwrap());
        }

        // Check any `else if` branches.
        for else_if in &self.else_ifs {
            let cond = ctx
                .execute_expr(
                    &else_if.cond,
                    exec_state,
                    &Metadata::from(self),
                    StatementKind::Expression,
                )
                .await?
                .get_bool()?;
            if cond {
                let block_result = ctx
                    .inner_execute(&else_if.then_val, exec_state, BodyType::Block)
                    .await?;
                // Block must end in an expression, so this has to be Some.
                // Enforced by the parser.
                // See https://github.com/KittyCAD/modeling-app/issues/4015
                return Ok(block_result.unwrap());
            }
        }

        // Run the final `else` branch.
        ctx.inner_execute(&self.final_else, exec_state, BodyType::Block)
            .await
            .map(|expr| expr.unwrap())
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

// Linting

impl IfExpression {}
impl ElseIf {}
