use std::collections::HashSet;

use crate::{
    KclError, SourceRange,
    errors::KclErrorDetails,
    front::{find_defined_names, next_free_name_using_max},
    parsing::ast::types as ast,
};

pub fn transpile(program: &mut ast::Node<ast::Program>) -> Result<(), KclError> {
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
}

#[derive(Debug, Clone, Default)]
struct Profile {
    surface: Option<(ast::Expr, Option<ast::Expr>)>,
    position: Option<ast::Expr>,
    sketch_block_body: Vec<ast::BodyItem>,
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
    let mut i = 0;
    while let Some(item) = block.body_mut().get_mut(i) {
        migrate_body_item(context, item)?;
        // Add any new declarations that were introduced while migrating
        // this item.
        let num_new_declarations = context.new_declarations.len();
        if num_new_declarations > 0 {
            // eprintln!("Splicing into index {i} {:?}", &context.new_declarations);
            block
                .body_mut()
                .splice(i..i, std::mem::take(&mut context.new_declarations));
        }
        i += 1 + num_new_declarations;
    }
    // Restore the previous defined names, since we're leaving this block.
    context.defined_names = previous_defined_names;
    Ok(())
}

fn migrate_body_item(context: &mut Context, item: &mut ast::BodyItem) -> Result<(), KclError> {
    match item {
        ast::BodyItem::ImportStatement(_) => Ok(()),
        ast::BodyItem::ExpressionStatement(node) => migrate_expr(context, &mut node.expression),
        ast::BodyItem::VariableDeclaration(node) => migrate_expr(context, &mut node.declaration.init),
        ast::BodyItem::TypeDeclaration(_) => Ok(()),
        ast::BodyItem::ReturnStatement(node) => migrate_expr(context, &mut node.argument),
    }
}

fn migrate_expr(context: &mut Context, expr: &mut ast::Expr) -> Result<(), KclError> {
    match expr {
        ast::Expr::Literal(_) => Ok(()),
        ast::Expr::Name(_) => Ok(()),
        ast::Expr::TagDeclarator(_) => Ok(()),
        ast::Expr::BinaryExpression(node) => {
            migrate_binary_expr(context, &mut node.left)?;
            migrate_binary_expr(context, &mut node.right)
        }
        ast::Expr::FunctionExpression(node) => migrate_block(context, &mut node.body),
        ast::Expr::CallExpressionKw(node) => migrate_call(context, node),
        ast::Expr::PipeExpression(node) => {
            eprintln!("Found PipeExpression");
            let mut sketch_surface = None;
            let mut profile = None;
            let mut sketch_var_name = None;
            for (_pipe_index, expr) in node.body.iter_mut().enumerate() {
                if let ast::Expr::CallExpressionKw(call) = expr {
                    match call.callee.name.name.as_ref() {
                        "startSketchOn" => {
                            // TODO: Handle a pipe value like:
                            // `XY |> startSketchOn()`
                            eprintln!("Found startSketchOn");
                            if let Some(unlabeled) = &call.unlabeled {
                                sketch_surface = Some((unlabeled.clone(), find_arg(&call.arguments, "face").cloned()));
                            }
                        }
                        "startProfile" => {
                            // We're starting a profile.
                            eprintln!("Found startProfile");
                            profile = Some(Profile {
                                surface: sketch_surface.clone(),
                                position: find_arg(&call.arguments, "at").cloned(),
                                ..Default::default()
                            });
                        }
                        "xLine" => {
                            if let Some(profile) = &mut profile {
                                let name = next_free_name("line", &context.defined_names, call.as_source_ranges())?;

                                let stmt = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                    Default::default(),
                                    Default::default(),
                                    Default::default(),
                                    ast::ExpressionStatement {
                                        expression: ast::Expr::CallExpressionKw(Box::new(ast::CallExpressionKw::new(
                                            "line",
                                            None,
                                            vec![ast::LabeledArg {
                                                label: Some(ast::Identifier::new("start")),
                                                arg: ast::Expr::SketchVar(ast::Node::boxed(
                                                    Default::default(),
                                                    Default::default(),
                                                    Default::default(),
                                                    ast::SketchVar {
                                                        initial: None,
                                                        digest: Default::default(),
                                                    },
                                                )),
                                            }],
                                        ))),
                                        digest: Default::default(),
                                    },
                                ));
                                profile.sketch_block_body.push(stmt);
                            }
                        }
                        "close" => {
                            // We're closing a profile.
                            eprintln!("Found close");
                            if let Some(profile) = profile.take() {
                                match profile.surface {
                                    Some((surface, _face)) => {
                                        // If we have a surface, we can convert to a sketch block.
                                        // TODO: Handle sketch on face.
                                        let items = profile.sketch_block_body;
                                        let body = ast::Block {
                                            items,
                                            non_code_meta: Default::default(),
                                            inner_attrs: Default::default(),
                                            digest: Default::default(),
                                        };
                                        let sketch_block = ast::Expr::SketchBlock(ast::Node::boxed(
                                            Default::default(),
                                            Default::default(),
                                            Default::default(),
                                            ast::SketchBlock {
                                                arguments: vec![ast::LabeledArg {
                                                    label: Some(ast::Identifier::new("on")),
                                                    arg: surface,
                                                }],
                                                body: ast::Node::new(
                                                    body,
                                                    Default::default(),
                                                    Default::default(),
                                                    Default::default(),
                                                ),
                                                is_being_edited: false,
                                                non_code_meta: Default::default(),
                                                digest: Default::default(),
                                            },
                                        ));
                                        let name =
                                            next_free_name("sketch", &context.defined_names, call.as_source_ranges())?;
                                        sketch_var_name = Some(name.clone());
                                        context.new_declarations.push(ast::BodyItem::VariableDeclaration(
                                            ast::Node::boxed(
                                                Default::default(),
                                                Default::default(),
                                                Default::default(),
                                                ast::VariableDeclaration {
                                                    declaration: ast::VariableDeclarator::new(
                                                        name.as_str(),
                                                        sketch_block,
                                                    ),
                                                    visibility: Default::default(),
                                                    kind: ast::VariableKind::Const,
                                                    digest: Default::default(),
                                                },
                                            ),
                                        ));
                                    }
                                    None => {
                                        // If we don't have a surface, we can't handle this yet.
                                        return Err(KclError::new_internal(KclErrorDetails::new(
                                            "Sketch profile, but I couldn't find its surface".to_owned(),
                                            call.as_source_ranges(),
                                        )));
                                    }
                                }
                            }
                        }
                        "extrude" => {
                            // Create a region and extrude it.
                            //
                            //     region1 = region(segments = [sketch1.seg1, sketch1.seg2]))
                            //     extrude(region1)
                        }
                        _ => {
                            eprintln!("Found unrecognized call: {}", &call.callee.name.name);
                        }
                    }
                }

                migrate_expr(context, expr)?;
            }
            Ok(())
        }
        ast::Expr::PipeSubstitution(_) => Ok(()),
        ast::Expr::ArrayExpression(node) => {
            for elem in &mut node.elements {
                migrate_expr(context, elem)?;
            }
            Ok(())
        }
        ast::Expr::ArrayRangeExpression(node) => {
            migrate_expr(context, &mut node.start_element)?;
            migrate_expr(context, &mut node.end_element)
        }
        ast::Expr::ObjectExpression(node) => {
            for prop in &mut node.properties {
                migrate_expr(context, &mut prop.value)?;
            }
            Ok(())
        }
        ast::Expr::MemberExpression(node) => {
            migrate_expr(context, &mut node.object)?;
            migrate_expr(context, &mut node.property)
        }
        ast::Expr::UnaryExpression(node) => migrate_binary_expr(context, &mut node.argument),
        ast::Expr::IfExpression(node) => {
            migrate_expr(context, &mut node.cond)?;
            migrate_block(context, &mut *node.then_val)?;
            for else_if in &mut node.else_ifs {
                migrate_expr(context, &mut else_if.cond)?;
                migrate_block(context, &mut *else_if.then_val)?;
            }
            migrate_block(context, &mut *node.final_else)?;
            Ok(())
        }
        ast::Expr::LabelledExpression(node) => migrate_expr(context, &mut node.expr),
        ast::Expr::AscribedExpression(node) => migrate_expr(context, &mut node.expr),
        ast::Expr::SketchBlock(_) => Ok(()),
        ast::Expr::SketchVar(_) => Ok(()),
        ast::Expr::None(_) => Ok(()),
    }
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
            migrate_expr(context, &mut node.property)
        }
        ast::BinaryPart::ArrayExpression(node) => {
            for elem in &mut node.elements {
                migrate_expr(context, elem)?;
            }
            Ok(())
        }
        ast::BinaryPart::ArrayRangeExpression(node) => {
            migrate_expr(context, &mut node.start_element)?;
            migrate_expr(context, &mut node.end_element)
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
        ast::BinaryPart::AscribedExpression(node) => migrate_expr(context, &mut node.expr),
        ast::BinaryPart::SketchVar(_) => Ok(()),
    }
}

fn find_arg<'a>(args: &'a [ast::LabeledArg], name: &str) -> Option<&'a ast::Expr> {
    // TODO: Also find shorthand args.
    args.iter()
        .find(|arg| arg.label.as_ref().map(|label| label.name.as_ref()) == Some(name))
        .map(|arg| &arg.arg)
}

fn next_free_name(
    prefix: &str,
    taken_names: &HashSet<String>,
    source_ranges: Vec<SourceRange>,
) -> Result<String, KclError> {
    next_free_name_using_max(prefix, taken_names, 999).map_err(|e| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to generate a unique name for {prefix}: {}", e),
            source_ranges,
        ))
    })
}
