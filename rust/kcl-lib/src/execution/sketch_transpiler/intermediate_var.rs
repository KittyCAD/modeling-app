use std::collections::HashSet;

use crate::KclError;
use crate::SourceRange;
use crate::errors::KclErrorDetails;
use crate::front::find_defined_names;
use crate::frontend::modify::next_free_name_with_padding;
use crate::parsing::ast::types::ItemVisibility;
use crate::parsing::ast::types::LabeledArg;
use crate::parsing::ast::types::PipeExpression;
use crate::parsing::ast::types::VariableDeclarator;
use crate::parsing::ast::types::VariableKind;
use crate::parsing::ast::types::{self as ast};

/// Transform code like this
///
/// ```ignore
/// // comment
/// myVar = foo
///   |> extrude(bar)
///   |> baz
/// ```
///
/// into
///
/// ```ignore
/// // comment
/// sketch1 = foo
/// myVar = extrude(sketch1, bar)
///   |> baz
/// ```
///
/// The name `sketch1` is generated. Semantics should be preserved.
///
/// Since the AST is mutated, source ranges will not be accurate.
pub(super) fn transpile(program: &mut ast::Node<ast::Program>) -> Result<(), KclError> {
    let mut context = Context::default();
    migrate_program(&mut context, program)?;
    Ok(())
}

#[derive(Debug, Clone, Default)]
struct Context {
    /// When transpiling an expression, we may need to introduce new variable
    /// declarations. We can store those here and add them to the program after
    /// transpiling the expression.
    new_declarations: Vec<ast::BodyItem>,
    /// The set of names that are currently defined in the scope we're
    /// transpiling.
    defined_names: HashSet<String>,
    pre_comments: Vec<String>,
}

fn migrate_program(context: &mut Context, program: &mut ast::Node<ast::Program>) -> Result<(), KclError> {
    migrate_block(context, program)?;
    Ok(())
}

fn migrate_block<B: ast::CodeBlock>(context: &mut Context, block: &mut B) -> Result<(), KclError> {
    // TODO: Include parameters if this is a function body.
    let block_defined_names = find_defined_names(block);
    let mut new_defined_names = context.defined_names.clone();
    new_defined_names.extend(block_defined_names);
    let previous_defined_names = std::mem::replace(&mut context.defined_names, new_defined_names);

    let previous_pre_comments = std::mem::take(&mut context.pre_comments);

    let mut i = 0;
    while let Some(item) = block.body_mut().get_mut(i) {
        migrate_body_item(context, item)?;
        // Add any new declarations that were introduced while migrating
        // this item.
        let num_new_declarations = context.new_declarations.len();
        if num_new_declarations > 0 {
            // Shift the block's non_code_meta keys to account for the
            // inserted declarations. Keys >= i need to increase by
            // num_new_declarations so they stay aligned with their
            // body items.
            let ncm = block.non_code_meta_mut();
            let shifted: std::collections::BTreeMap<usize, _> = std::mem::take(&mut ncm.non_code_nodes)
                .into_iter()
                .map(|(k, v)| if k >= i { (k + num_new_declarations, v) } else { (k, v) })
                .collect();
            ncm.non_code_nodes = shifted;

            block
                .body_mut()
                .splice(i..i, std::mem::take(&mut context.new_declarations));
        }
        i += 1 + num_new_declarations;
    }

    // Restore the previous context, since we're leaving this block.
    context.pre_comments = previous_pre_comments;
    context.defined_names = previous_defined_names;

    Ok(())
}

fn migrate_body_item(context: &mut Context, item: &mut ast::BodyItem) -> Result<(), KclError> {
    match item {
        ast::BodyItem::ImportStatement(_) => {}
        ast::BodyItem::ExpressionStatement(node) => {
            if !node.pre_comments.is_empty() {
                // Clone node's comments so that it's available while migrating
                // the expression.
                context.pre_comments = node.pre_comments.clone();
            }
            let strip_node = migrate_expr(context, &mut node.expression)?;
            if strip_node {
                node.pre_comments = Default::default();
            }
            context.pre_comments = Default::default();
        }
        ast::BodyItem::VariableDeclaration(node) => {
            if !node.pre_comments.is_empty() {
                // Clone node's comments so that it's available while migrating
                // the expression.
                context.pre_comments = node.pre_comments.clone();
            }
            let strip_node = migrate_expr(context, &mut node.declaration.init)?;
            if strip_node {
                node.pre_comments = Default::default();
            }
            context.pre_comments = Default::default();
        }
        ast::BodyItem::TypeDeclaration(_) => {}
        ast::BodyItem::ReturnStatement(node) => {
            if !node.pre_comments.is_empty() {
                // Clone node's comments so that it's available while migrating
                // the expression.
                context.pre_comments = node.pre_comments.clone();
            }
            let strip_node = migrate_expr(context, &mut node.argument)?;
            if strip_node {
                node.pre_comments = Default::default();
            }
            context.pre_comments = Default::default();
        }
    }
    Ok(())
}

/// Returns true if a pipe was extracted and the caller should clear the
/// comments on the passed in node. In this case, the comments from the context
/// will have been moved to the new node.
fn migrate_expr(context: &mut Context, expr: &mut ast::Expr) -> Result<bool, KclError> {
    let range = SourceRange::from(&*expr);
    match expr {
        ast::Expr::Literal(_) => Ok(false),
        ast::Expr::Name(_) => Ok(false),
        ast::Expr::TagDeclarator(_) => Ok(false),
        ast::Expr::BinaryExpression(node) => {
            migrate_binary_expr(context, &mut node.left)?;
            migrate_binary_expr(context, &mut node.right)?;
            Ok(false)
        }
        ast::Expr::FunctionExpression(node) => {
            migrate_block(context, &mut node.body)?;
            Ok(false)
        }
        ast::Expr::CallExpressionKw(node) => {
            migrate_call(context, node)?;
            Ok(false)
        }
        ast::Expr::PipeExpression(node) => {
            let mut new_pipe = None;
            for (pipe_index, expr) in node.body.iter_mut().enumerate() {
                if let ast::Expr::CallExpressionKw(call) = expr {
                    let callee_name = call.callee.name.name.as_ref();
                    match callee_name {
                        "extrude" | "revolve" | "sweep" | "loft" => {
                            if pipe_index == 0 {
                                // If the extrusion is already the first thing
                                // in the pipeline, we don't need to do
                                // anything. TODO: Should we continue to
                                // recurse?
                                break;
                            }
                            // We've found a pipeline that needs to be
                            // transformed.

                            // Set the current pipe body item unlabeled
                            // argument.
                            let sketch_name = next_free_name("sketch", &context.defined_names, vec![range])?;
                            // Track the new identifier as defined.
                            context.defined_names.insert(sketch_name.clone());
                            // If call has an explicit unlabeled arg, we
                            // shouldn't change it.
                            if is_unlabeled_pipe_value(call) {
                                call.unlabeled = Some(ast::Expr::Name(Box::new(ast::Name::new(&sketch_name))));
                            } else if is_labeled_shorthand(call) {
                                let shorthand_arg = call
                                    .unlabeled
                                    .replace(ast::Expr::Name(Box::new(ast::Name::new(&sketch_name))));
                                if let Some(arg) = shorthand_arg {
                                    call.arguments.insert(0, LabeledArg { label: None, arg });
                                }
                            }
                            new_pipe = Some((pipe_index, sketch_name));
                            break;
                        }
                        _ => {}
                    }
                }

                migrate_expr(context, expr)?;
            }
            let Some((new_start_index, sketch_name)) = new_pipe else {
                return Ok(false);
            };
            let sketch_pipe_body = node.body.drain(..new_start_index).collect();
            let sketch_non_code_meta = node.non_code_meta.split_at(new_start_index);
            let pipe_expr = ast::Expr::PipeExpression(Box::new(ast::Node::no_src(PipeExpression {
                body: sketch_pipe_body,
                non_code_meta: sketch_non_code_meta,
                digest: None,
            })));
            let mut var_decl = ast::Node::boxed(
                Default::default(),
                Default::default(),
                Default::default(),
                ast::VariableDeclaration::new(
                    VariableDeclarator::new(&sketch_name, pipe_expr),
                    ItemVisibility::Default,
                    VariableKind::Const,
                ),
            );
            var_decl.pre_comments = std::mem::take(&mut context.pre_comments);
            context
                .new_declarations
                .push(ast::BodyItem::VariableDeclaration(var_decl));
            Ok(true)
        }
        ast::Expr::PipeSubstitution(_) => Ok(false),
        ast::Expr::ArrayExpression(node) => {
            for elem in &mut node.elements {
                migrate_expr(context, elem)?;
            }
            Ok(false)
        }
        ast::Expr::ArrayRangeExpression(node) => {
            migrate_expr(context, &mut node.start_element)?;
            migrate_expr(context, &mut node.end_element)?;
            Ok(false)
        }
        ast::Expr::ObjectExpression(node) => {
            for prop in &mut node.properties {
                migrate_expr(context, &mut prop.value)?;
            }
            Ok(false)
        }
        ast::Expr::MemberExpression(node) => {
            migrate_expr(context, &mut node.object)?;
            migrate_expr(context, &mut node.property)?;
            Ok(false)
        }
        ast::Expr::UnaryExpression(node) => {
            migrate_binary_expr(context, &mut node.argument)?;
            Ok(false)
        }
        ast::Expr::IfExpression(node) => {
            migrate_expr(context, &mut node.cond)?;
            migrate_block(context, &mut *node.then_val)?;
            for else_if in &mut node.else_ifs {
                migrate_expr(context, &mut else_if.cond)?;
                migrate_block(context, &mut *else_if.then_val)?;
            }
            migrate_block(context, &mut *node.final_else)?;
            Ok(false)
        }
        ast::Expr::LabelledExpression(node) => {
            migrate_expr(context, &mut node.expr)?;
            Ok(false)
        }
        ast::Expr::AscribedExpression(node) => {
            migrate_expr(context, &mut node.expr)?;
            Ok(false)
        }
        ast::Expr::SketchBlock(_) => Ok(false),
        ast::Expr::SketchVar(_) => Ok(false),
        ast::Expr::None(_) => Ok(false),
    }
}

/// Returns true if the call's unlabeled arg is the pipe value.
fn is_unlabeled_pipe_value(call: &ast::Node<ast::CallExpressionKw>) -> bool {
    // A call's unlabeled arg is the pipe value if it's None or %.
    let Some(unlabeled) = &call.unlabeled else {
        return true;
    };
    matches!(unlabeled, ast::Expr::PipeSubstitution(_))
}

/// Returns true if the call's unlabeled arg is actually a labeled arg that's
/// using shorthand syntax.
fn is_labeled_shorthand(call: &ast::Node<ast::CallExpressionKw>) -> bool {
    let Some(unlabeled) = &call.unlabeled else {
        return false;
    };
    let ast::Expr::Name(name) = unlabeled else {
        return false;
    };
    // We currently only recognize specific arguments.
    call.callee.name.name == "extrude" && (name.name.name == "length" || name.name.name == "twistAngle")
        || call.callee.name.name == "revolve" && (name.name.name == "angle" || name.name.name == "axis")
}

fn migrate_call(context: &mut Context, node: &mut ast::Node<ast::CallExpressionKw>) -> Result<(), KclError> {
    for (_, arg) in &mut node.iter_arguments_mut() {
        migrate_expr(context, arg)?;
    }
    Ok(())
}

fn migrate_binary_expr(context: &mut Context, binary_part: &mut ast::BinaryPart) -> Result<(), KclError> {
    match binary_part {
        ast::BinaryPart::Literal(_) => Ok(()),
        ast::BinaryPart::Name(_) => Ok(()),
        ast::BinaryPart::BinaryExpression(node) => {
            migrate_binary_expr(context, &mut node.left)?;
            migrate_binary_expr(context, &mut node.right)
        }
        ast::BinaryPart::CallExpressionKw(node) => migrate_call(context, node),
        ast::BinaryPart::UnaryExpression(node) => migrate_binary_expr(context, &mut node.argument),
        ast::BinaryPart::MemberExpression(node) => {
            migrate_expr(context, &mut node.object)?;
            migrate_expr(context, &mut node.property)?;
            Ok(())
        }
        ast::BinaryPart::ArrayExpression(node) => {
            for elem in &mut node.elements {
                migrate_expr(context, elem)?;
            }
            Ok(())
        }
        ast::BinaryPart::ArrayRangeExpression(node) => {
            migrate_expr(context, &mut node.start_element)?;
            migrate_expr(context, &mut node.end_element)?;
            Ok(())
        }
        ast::BinaryPart::ObjectExpression(node) => {
            for prop in &mut node.properties {
                migrate_expr(context, &mut prop.value)?;
            }
            Ok(())
        }
        ast::BinaryPart::IfExpression(node) => {
            migrate_expr(context, &mut node.cond)?;
            migrate_block(context, &mut *node.then_val)?;
            for else_if in &mut node.else_ifs {
                migrate_expr(context, &mut else_if.cond)?;
                migrate_block(context, &mut *else_if.then_val)?;
            }
            migrate_block(context, &mut *node.final_else)?;
            Ok(())
        }
        ast::BinaryPart::AscribedExpression(node) => {
            migrate_expr(context, &mut node.expr)?;
            Ok(())
        }
        ast::BinaryPart::SketchVar(_) => Ok(()),
    }
}

fn next_free_name(
    prefix: &str,
    taken_names: &HashSet<String>,
    source_ranges: Vec<SourceRange>,
) -> Result<String, KclError> {
    next_free_name_with_padding(prefix, taken_names).map_err(|e| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to generate a unique name for {prefix}: {}", e),
            source_ranges,
        ))
    })
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::parsing::top_level_parse;

    /// Parse, run the intermediate-var transpiler, and recast.
    fn transpile_and_recast(code: &str) -> String {
        let mut program = top_level_parse(code).unwrap();
        transpile(&mut program).unwrap();
        program.recast_top(&Default::default(), 0)
    }

    #[test]
    fn test_transpile_preserves_inline_comments() {
        let input = "\
fn prism(minX, minY, minZ, sizeX, sizeY, sizeZ) {
  return startSketchOn(XY)
    // Start a 2D sketch on the global XY plane
    |> rectangle(width = sizeX, height = sizeY, corner = [minX, minY]) // Draw the 2x4 cross-section at the given corner
    |> extrude(length = sizeZ) // Create a 3D prism by extruding the rectangle along +Z
    |> appearance(color = woodColor, roughness = woodRoughness, metalness = woodMetalness) // Apply a wood-like material
    |> translate(z = minZ) // Position the prism so its bottom sits at minZ
}
";
        let expected = "\
fn prism(minX, minY, minZ, sizeX, sizeY, sizeZ) {
  sketch001 = startSketchOn(XY)
    // Start a 2D sketch on the global XY plane
    |> rectangle(width = sizeX, height = sizeY, corner = [minX, minY]) // Draw the 2x4 cross-section at the given corner
  return extrude(sketch001, length = sizeZ) // Create a 3D prism by extruding the rectangle along +Z
    |> appearance(color = woodColor, roughness = woodRoughness, metalness = woodMetalness) // Apply a wood-like material
    |> translate(z = minZ) // Position the prism so its bottom sits at minZ
}
";
        assert_eq!(transpile_and_recast(input), expected);
    }
}
