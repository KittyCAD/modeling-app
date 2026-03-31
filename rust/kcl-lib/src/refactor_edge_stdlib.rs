//! Refactor fillet/chamfer `tags` that use deprecated edge stdlib calls to `edges`.
//! Step 3 of the Z0006 upgrade path: pure AST transform using execution metadata (no re-execution).
//! Called from the frontend with program AST + edgeRefactorMetadata from ExecState.

#[cfg(feature = "artifact-graph")]
use anyhow::Result;

#[cfg(feature = "artifact-graph")]
use crate::SourceRange;
#[cfg(feature = "artifact-graph")]
use crate::execution::EdgeRefactorMeta;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::ArrayExpression;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::BinaryPart;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::CallExpressionKw;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::Expr;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::Identifier;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::Literal;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::LiteralValue;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::ObjectExpression;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::ObjectProperty;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::Program;

const DEPRECATED_EDGE_STDLIB: &[&str] = &[
    "getOppositeEdge",
    "getNextAdjacentEdge",
    "getPreviousAdjacentEdge",
    "getCommonEdge",
    "edgeId",
];

fn is_fillet_or_chamfer(callee_name: &str) -> bool {
    matches!(callee_name, "fillet" | "chamfer")
}

fn is_deprecated_edge_stdlib(callee_name: &str) -> bool {
    DEPRECATED_EDGE_STDLIB.contains(&callee_name)
}

/// Find the "tags" labeled argument and return mutable ref to the array and its index.
#[cfg(feature = "artifact-graph")]
fn get_tags_arg_mut(call: &mut CallExpressionKw) -> Option<(usize, &mut Expr)> {
    for (i, arg) in call.arguments.iter_mut().enumerate() {
        let label_name = arg.label.as_ref().map(|l| l.name.as_str()).unwrap_or("");
        if label_name == "tags" {
            return Some((i, &mut arg.arg));
        }
    }
    None
}

#[cfg(feature = "artifact-graph")]
fn try_replace_fillet_chamfer(call: &mut CallExpressionKw, metadata: &[EdgeRefactorMeta]) {
    let callee_name = call.callee.name.name.as_str();
    if !is_fillet_or_chamfer(callee_name) {
        return;
    }
    // Collect (tags_arg_index, deprecated_ranges) without holding &mut to arg.arg so we can replace later.
    let (tags_arg_index, deprecated_ranges): (usize, Vec<(SourceRange, usize)>) = {
        let (i, tags_expr) = match get_tags_arg_mut(call) {
            Some(x) => x,
            None => return,
        };
        let tags_array = match tags_expr {
            Expr::ArrayExpression(arr) => arr,
            _ => return,
        };
        let ranges: Vec<_> = tags_array
            .elements
            .iter()
            .enumerate()
            .filter_map(|(idx, element)| {
                let Expr::CallExpressionKw(inner) = element else {
                    return None;
                };
                if is_deprecated_edge_stdlib(inner.callee.name.name.as_str()) {
                    Some((SourceRange::new(inner.start, inner.end, inner.module_id), idx))
                } else {
                    None
                }
            })
            .collect();
        (i, ranges)
    };
    if deprecated_ranges.is_empty() {
        return;
    }
    // Match each deprecated call to metadata by source range.
    let mut ordered_metas: Vec<&EdgeRefactorMeta> = vec![];
    for (sr, _idx) in &deprecated_ranges {
        let meta = metadata.iter().find(|m| {
            m.source_range.start() == sr.start()
                && m.source_range.end() == sr.end()
                && m.source_range.module_id() == sr.module_id()
        });
        match meta {
            Some(m) => ordered_metas.push(m),
            None => return, // can't resolve all, skip this call
        }
    }
    // Build edges array: [ { sideFaces: [uuid0, uuid1] }, ... ] (KCL uses camelCase)
    let edge_refs_elements: Vec<Expr> = ordered_metas
        .into_iter()
        .map(|meta| {
            let faces_arr = Expr::ArrayExpression(Box::new(ArrayExpression::new(vec![
                Expr::Literal(Box::new(Literal::new(LiteralValue::String(
                    meta.face_ids[0].to_string(),
                )))),
                Expr::Literal(Box::new(Literal::new(LiteralValue::String(
                    meta.face_ids[1].to_string(),
                )))),
            ])));
            let prop = ObjectProperty::new(Identifier::new("sideFaces"), faces_arr);
            Expr::ObjectExpression(Box::new(ObjectExpression::new(vec![prop])))
        })
        .collect();
    let new_edge_refs_array = Expr::ArrayExpression(Box::new(ArrayExpression::new(edge_refs_elements)));
    // Replace the tags argument with edges (same index, change label and value).
    let arg = &mut call.arguments[tags_arg_index];
    arg.label = Some(Identifier::new("edges"));
    arg.arg = new_edge_refs_array;
}

#[cfg(feature = "artifact-graph")]
fn visit_binary_part_mut(part: &mut BinaryPart, metadata: &[EdgeRefactorMeta]) {
    match part {
        BinaryPart::CallExpressionKw(call) => {
            try_replace_fillet_chamfer(call, metadata);
            if let Some(unlabeled) = &mut call.unlabeled {
                visit_expr_mut(unlabeled, metadata);
            }
            for arg in &mut call.arguments {
                visit_expr_mut(&mut arg.arg, metadata);
            }
        }
        BinaryPart::BinaryExpression(inner) => {
            visit_binary_part_mut(&mut inner.left, metadata);
            visit_binary_part_mut(&mut inner.right, metadata);
        }
        BinaryPart::UnaryExpression(u) => visit_binary_part_mut(&mut u.argument, metadata),
        BinaryPart::ArrayExpression(arr) => {
            for e in &mut arr.elements {
                visit_expr_mut(e, metadata);
            }
        }
        BinaryPart::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                visit_expr_mut(&mut prop.value, metadata);
            }
        }
        BinaryPart::ArrayRangeExpression(r) => {
            visit_expr_mut(&mut r.start_element, metadata);
            visit_expr_mut(&mut r.end_element, metadata);
        }
        BinaryPart::AscribedExpression(asc) => visit_expr_mut(&mut asc.expr, metadata),
        BinaryPart::IfExpression(if_expr) => {
            visit_expr_mut(&mut if_expr.cond, metadata);
            for item in &mut if_expr.then_val.body {
                visit_body_item_expr_mut(item, metadata);
            }
            for else_if in &mut if_expr.else_ifs {
                visit_expr_mut(&mut else_if.cond, metadata);
                for item in &mut else_if.then_val.body {
                    visit_body_item_expr_mut(item, metadata);
                }
            }
            for item in &mut if_expr.final_else.body {
                visit_body_item_expr_mut(item, metadata);
            }
        }
        BinaryPart::MemberExpression(m) => {
            visit_expr_mut(&mut m.object, metadata);
            visit_expr_mut(&mut m.property, metadata);
        }
        BinaryPart::Literal(_) | BinaryPart::Name(_) | BinaryPart::SketchVar(_) => {}
    }
}

#[cfg(feature = "artifact-graph")]
fn visit_expr_mut(expr: &mut Expr, metadata: &[EdgeRefactorMeta]) {
    match expr {
        Expr::CallExpressionKw(call) => {
            try_replace_fillet_chamfer(call, metadata);
            if let Some(unlabeled) = &mut call.unlabeled {
                visit_expr_mut(unlabeled, metadata);
            }
            for arg in &mut call.arguments {
                visit_expr_mut(&mut arg.arg, metadata);
            }
        }
        Expr::PipeExpression(pipe) => {
            for e in &mut pipe.body {
                visit_expr_mut(e, metadata);
            }
        }
        Expr::BinaryExpression(bin) => {
            visit_binary_part_mut(&mut bin.left, metadata);
            visit_binary_part_mut(&mut bin.right, metadata);
        }
        Expr::ArrayExpression(arr) => {
            for e in &mut arr.elements {
                visit_expr_mut(e, metadata);
            }
        }
        Expr::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                visit_expr_mut(&mut prop.value, metadata);
            }
        }
        Expr::LabelledExpression(lab) => visit_expr_mut(&mut lab.expr, metadata),
        Expr::AscribedExpression(asc) => visit_expr_mut(&mut asc.expr, metadata),
        Expr::UnaryExpression(u) => visit_binary_part_mut(&mut u.argument, metadata),
        Expr::MemberExpression(m) => {
            visit_expr_mut(&mut m.object, metadata);
            visit_expr_mut(&mut m.property, metadata);
        }
        Expr::ArrayRangeExpression(r) => {
            visit_expr_mut(&mut r.start_element, metadata);
            visit_expr_mut(&mut r.end_element, metadata);
        }
        Expr::IfExpression(if_expr) => {
            visit_expr_mut(&mut if_expr.cond, metadata);
            for item in &mut if_expr.then_val.body {
                visit_body_item_expr_mut(item, metadata);
            }
            for else_if in &mut if_expr.else_ifs {
                visit_expr_mut(&mut else_if.cond, metadata);
                for item in &mut else_if.then_val.body {
                    visit_body_item_expr_mut(item, metadata);
                }
            }
            for item in &mut if_expr.final_else.body {
                visit_body_item_expr_mut(item, metadata);
            }
        }
        Expr::SketchBlock(sk) => {
            for item in &mut sk.body.items {
                visit_body_item_expr_mut(item, metadata);
            }
        }
        Expr::FunctionExpression(f) => {
            for item in &mut f.body.body {
                visit_body_item_expr_mut(item, metadata);
            }
        }
        _ => {}
    }
}

#[cfg(feature = "artifact-graph")]
fn visit_body_item_expr_mut(item: &mut crate::parsing::ast::types::BodyItem, metadata: &[EdgeRefactorMeta]) {
    use crate::parsing::ast::types::BodyItem;
    match item {
        BodyItem::ExpressionStatement(stmt) => visit_expr_mut(&mut stmt.expression, metadata),
        BodyItem::VariableDeclaration(decl) => visit_expr_mut(&mut decl.declaration.init, metadata),
        BodyItem::ReturnStatement(stmt) => visit_expr_mut(&mut stmt.argument, metadata),
        _ => {}
    }
}

/// Refactor all fillet/chamfer calls that have deprecated edge stdlib in `tags` to use `edges`.
/// Uses `edge_refactor_metadata` from execution to fill in face IDs. Mutates the program in place.
#[cfg(feature = "artifact-graph")]
pub fn refactor_fillet_chamfer_tags_to_edge_refs(
    program: &mut Program,
    edge_refactor_metadata: &[EdgeRefactorMeta],
) -> Result<()> {
    if edge_refactor_metadata.is_empty() {
        return Ok(());
    }
    for item in &mut program.body {
        visit_body_item_expr_mut(item, edge_refactor_metadata);
    }
    Ok(())
}
