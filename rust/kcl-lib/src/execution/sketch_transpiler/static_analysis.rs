use std::collections::HashSet;

use crate::{
    KclError, SourceRange,
    errors::KclErrorDetails,
    front::{find_defined_names, next_free_name_using_max},
    parsing::ast::types::{self as ast, BinaryOperator, ItemVisibility, LiteralValue, VariableKind},
    pretty::NumericSuffix,
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
    /// The surface we're sketching on, i.e. the arguments to `startSketchOn()`.
    surface: Option<(ast::Expr, Option<ast::Expr>)>,
    /// The position of the profile, used for creating coincident constraints
    /// with the first segment when a complex expression was used for
    /// `startProfile(at)`.
    position: Option<ast::Expr>,
    /// The name of the first segment in the profile, used for creating
    /// coincident constraints with the last segment when closing the profile.
    first_segment_name: Option<String>,
    /// The name of the previous segment in the profile, used for creating
    /// coincident constraints with the next segment.
    previous_segment_name: Option<String>,
    /// All segment names in the profile, used for creating regions.
    segment_names: Vec<String>,
    /// Built up body of the sketch block for this profile, which we'll insert
    /// into the program when we find the `close` call.
    sketch_block_body: Vec<ast::BodyItem>,
}

#[derive(Debug, Clone, Default)]
struct SketchBlockValue {
    /// The name of the sketch variable, used for creating regions from the
    /// sketch.
    name: String,
    /// The surface we're sketching on, i.e. the arguments to `startSketchOn()`.
    #[expect(dead_code)]
    surface: Option<(ast::Expr, Option<ast::Expr>)>,
    /// All segment names in the profile, used for creating regions.
    segment_names: Vec<String>,
}

fn migrate_program(context: &mut Context, program: &mut ast::Node<ast::Program>) -> Result<(), KclError> {
    // Allow experimental features.
    program.set_experimental_features(Some(crate::exec::WarningLevel::Allow));
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
            let mut sketch_surface = None;
            let mut profile = None;
            let mut sketch_block_value = None;
            let mut return_expr = None;
            for expr in node.body.iter_mut() {
                if let ast::Expr::CallExpressionKw(call) = expr {
                    match call.callee.name.name.as_ref() {
                        "startSketchOn" => {
                            // TODO: Handle a pipe value like:
                            // `XY |> startSketchOn()`
                            if let Some(unlabeled) = &call.unlabeled {
                                sketch_surface = Some((unlabeled.clone(), find_arg(&call.arguments, "face").cloned()));
                            }
                        }
                        "startProfile" => {
                            // We're starting a profile.
                            profile = Some(Profile {
                                surface: sketch_surface.clone(),
                                position: find_arg(&call.arguments, "at").cloned(),
                                ..Default::default()
                            });
                        }
                        "xLine" | "yLine" => {
                            let is_vertical = &call.callee.name.name == "yLine";

                            if let Some(profile) = &mut profile {
                                let (start_pt, end_pt) = if let Some(position) = &profile.position
                                    && let Some((x, y)) = is_free_point2d(position)
                                {
                                    (
                                        position.clone(),
                                        point2d_ast(
                                            ast::Expr::BinaryExpression(Box::new(ast::BinaryExpression::new(
                                                BinaryOperator::Add,
                                                ast::BinaryPart::try_from(x.clone())?,
                                                ast::BinaryPart::Literal(Box::new(ast::Literal::new(
                                                    LiteralValue::Number {
                                                        value: 1.0,
                                                        suffix: NumericSuffix::None,
                                                    },
                                                ))),
                                            ))),
                                            y.clone(),
                                        ),
                                    )
                                } else {
                                    (
                                        // If we don't have a position, we can
                                        // just use the origin.
                                        point2d_ast(
                                            sketch_var_ast("0", 0.0, NumericSuffix::None),
                                            sketch_var_ast("0", 0.0, NumericSuffix::None),
                                        ),
                                        // Must be different from start to avoid
                                        // zero-length line, which is
                                        // problematic for the solver.
                                        if is_vertical {
                                            point2d_ast(
                                                sketch_var_ast("0", 0.0, NumericSuffix::None),
                                                sketch_var_ast("1", 1.0, NumericSuffix::None),
                                            )
                                        } else {
                                            point2d_ast(
                                                sketch_var_ast("1", 1.0, NumericSuffix::None),
                                                sketch_var_ast("0", 0.0, NumericSuffix::None),
                                            )
                                        },
                                    )
                                };

                                // Define the line.
                                let name = next_free_name("line", &context.defined_names, call.as_source_ranges())?;
                                let line_call = ast::Expr::CallExpressionKw(Box::new(ast::CallExpressionKw::new(
                                    "line",
                                    None,
                                    vec![
                                        ast::LabeledArg {
                                            label: Some(ast::Identifier::new("start")),
                                            arg: start_pt,
                                        },
                                        ast::LabeledArg {
                                            label: Some(ast::Identifier::new("end")),
                                            arg: end_pt,
                                        },
                                    ],
                                )));
                                let line_stmt = ast::BodyItem::VariableDeclaration(ast::Node::boxed(
                                    Default::default(),
                                    Default::default(),
                                    Default::default(),
                                    ast::VariableDeclaration::new(
                                        ast::VariableDeclarator::new(name.as_str(), line_call),
                                        ItemVisibility::Default,
                                        VariableKind::Const,
                                    ),
                                ));
                                profile.sketch_block_body.push(line_stmt);
                                profile.segment_names.push(name.clone());
                                context.defined_names.insert(name.clone());

                                // Create horizontal/vertical constraint.
                                let horizontal_call = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                    Default::default(),
                                    Default::default(),
                                    Default::default(),
                                    ast::ExpressionStatement {
                                        expression: ast::Expr::CallExpressionKw(Box::new(ast::CallExpressionKw::new(
                                            if is_vertical { "vertical" } else { "horizontal" },
                                            Some(ast::Expr::Name(Box::new(ast::Name::new(name.as_str())))),
                                            Default::default(),
                                        ))),
                                        digest: None,
                                    },
                                ));
                                profile.sketch_block_body.push(horizontal_call);

                                // Create length constraint.
                                if let Some(length_arg) = find_arg(&call.arguments, "length") {
                                    let distance_call = ast::CallExpressionKw::new(
                                        "distance",
                                        Some(array2_ast(
                                            name_dot_name_ast(&name, "start"),
                                            name_dot_name_ast(&name, "end"),
                                        )),
                                        Default::default(),
                                    );
                                    let length_stmt = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::ExpressionStatement {
                                            expression: ast::Expr::BinaryExpression(Box::new(
                                                ast::BinaryExpression::new(
                                                    BinaryOperator::Eq,
                                                    ast::BinaryPart::CallExpressionKw(Box::new(distance_call)),
                                                    ast::BinaryPart::try_from(length_arg.clone())?,
                                                ),
                                            )),
                                            digest: None,
                                        },
                                    ));
                                    profile.sketch_block_body.push(length_stmt);
                                }

                                // If the start point was not a literal Point2d,
                                // create start point coincident constraint.
                                if let Some(start_position) = profile.position.take()
                                    && is_free_point2d(&start_position).is_none()
                                {
                                    // Define the point.
                                    let point_name =
                                        next_free_name("point", &context.defined_names, call.as_source_ranges())?;
                                    let point_call = ast::Expr::CallExpressionKw(Box::new(ast::CallExpressionKw::new(
                                        "point",
                                        None,
                                        vec![ast::LabeledArg {
                                            label: Some(ast::Identifier::new("at")),
                                            arg: start_position,
                                        }],
                                    )));
                                    let point_stmt = ast::BodyItem::VariableDeclaration(ast::Node::boxed(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::VariableDeclaration::new(
                                            ast::VariableDeclarator::new(point_name.as_str(), point_call),
                                            ItemVisibility::Default,
                                            VariableKind::Const,
                                        ),
                                    ));
                                    profile.sketch_block_body.push(point_stmt);

                                    let coincident_call = ast::CallExpressionKw::new(
                                        "coincident",
                                        Some(array2_ast(
                                            ast::Expr::Name(Box::new(ast::Name::new(point_name.as_str()))),
                                            name_dot_name_ast(&name, "start"),
                                        )),
                                        Default::default(),
                                    );
                                    let coincident_stmt = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::ExpressionStatement {
                                            expression: ast::Expr::CallExpressionKw(Box::new(coincident_call)),
                                            digest: None,
                                        },
                                    ));
                                    profile.sketch_block_body.push(coincident_stmt);
                                }

                                // If we have a previous segment in the profile,
                                // create a coincident constraint between the
                                // end of the previous segment and the start of
                                // this one.
                                if let Some(previous_segment) = profile.previous_segment_name.take() {
                                    let coincident_call = ast::CallExpressionKw::new(
                                        "coincident",
                                        Some(array2_ast(
                                            name_dot_name_ast(&previous_segment, "end"),
                                            name_dot_name_ast(&name, "start"),
                                        )),
                                        Default::default(),
                                    );
                                    let coincident_stmt = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::ExpressionStatement {
                                            expression: ast::Expr::CallExpressionKw(Box::new(coincident_call)),
                                            digest: None,
                                        },
                                    ));
                                    profile.sketch_block_body.push(coincident_stmt);
                                }

                                if profile.first_segment_name.is_none() {
                                    profile.first_segment_name = Some(name.clone());
                                }
                                profile.previous_segment_name = Some(name.clone());
                            }
                        }
                        "angledLine" => {
                            if let Some(profile) = &mut profile {
                                let (start_pt, end_pt) = if let Some(position) = &profile.position
                                    && let Some((x, y)) = is_free_point2d(position)
                                {
                                    (
                                        position.clone(),
                                        point2d_ast(
                                            ast::Expr::BinaryExpression(Box::new(ast::BinaryExpression::new(
                                                BinaryOperator::Add,
                                                ast::BinaryPart::try_from(x.clone())?,
                                                ast::BinaryPart::Literal(Box::new(ast::Literal::new(
                                                    LiteralValue::Number {
                                                        value: 1.0,
                                                        suffix: NumericSuffix::None,
                                                    },
                                                ))),
                                            ))),
                                            y.clone(),
                                        ),
                                    )
                                } else {
                                    (
                                        // If we don't have a position, we can
                                        // just use the origin.
                                        point2d_ast(
                                            sketch_var_ast("0", 0.0, NumericSuffix::None),
                                            sketch_var_ast("0", 0.0, NumericSuffix::None),
                                        ),
                                        // Must be different from start to avoid
                                        // zero-length line, which is
                                        // problematic for the solver.
                                        point2d_ast(
                                            sketch_var_ast("1", 1.0, NumericSuffix::None),
                                            sketch_var_ast("0", 0.0, NumericSuffix::None),
                                        ),
                                    )
                                };

                                // Define the line.
                                let name = next_free_name("line", &context.defined_names, call.as_source_ranges())?;
                                let line_call = ast::Expr::CallExpressionKw(Box::new(ast::CallExpressionKw::new(
                                    "line",
                                    None,
                                    vec![
                                        ast::LabeledArg {
                                            label: Some(ast::Identifier::new("start")),
                                            arg: start_pt,
                                        },
                                        ast::LabeledArg {
                                            label: Some(ast::Identifier::new("end")),
                                            arg: end_pt,
                                        },
                                    ],
                                )));
                                let line_stmt = ast::BodyItem::VariableDeclaration(ast::Node::boxed(
                                    Default::default(),
                                    Default::default(),
                                    Default::default(),
                                    ast::VariableDeclaration::new(
                                        ast::VariableDeclarator::new(name.as_str(), line_call),
                                        ItemVisibility::Default,
                                        VariableKind::Const,
                                    ),
                                ));
                                profile.sketch_block_body.push(line_stmt);
                                profile.segment_names.push(name.clone());
                                context.defined_names.insert(name.clone());

                                // Create angle constraint.
                                if let Some(angle_arg) = find_arg(&call.arguments, "angle")
                                    && let Some(previous_segment_name) = &profile.previous_segment_name
                                {
                                    let angle_call = ast::CallExpressionKw::new(
                                        "angle",
                                        Some(array2_ast(
                                            ast::Expr::Name(Box::new(ast::Name::new(previous_segment_name.as_str()))),
                                            ast::Expr::Name(Box::new(ast::Name::new(name.as_str()))),
                                        )),
                                        Default::default(),
                                    );
                                    let length_stmt = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::ExpressionStatement {
                                            expression: ast::Expr::BinaryExpression(Box::new(
                                                ast::BinaryExpression::new(
                                                    BinaryOperator::Eq,
                                                    ast::BinaryPart::CallExpressionKw(Box::new(angle_call)),
                                                    ast::BinaryPart::try_from(angle_arg.clone())?,
                                                ),
                                            )),
                                            digest: None,
                                        },
                                    ));
                                    profile.sketch_block_body.push(length_stmt);
                                }

                                // Create the
                                // distance/horizontalDistance/verticalDistance
                                // constraint.
                                for labeled_arg in &call.arguments {
                                    let fn_name = match labeled_arg.label.as_ref().map(|label| label.name.as_ref()) {
                                        Some("length") => "distance",
                                        Some("lengthX") => "horizontalDistance",
                                        Some("lengthY") => "verticalDistance",
                                        _ => continue,
                                    };
                                    let distance_call = ast::CallExpressionKw::new(
                                        fn_name,
                                        Some(array2_ast(
                                            name_dot_name_ast(&name, "start"),
                                            name_dot_name_ast(&name, "end"),
                                        )),
                                        Default::default(),
                                    );
                                    let length_stmt = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::ExpressionStatement {
                                            expression: ast::Expr::BinaryExpression(Box::new(
                                                ast::BinaryExpression::new(
                                                    BinaryOperator::Eq,
                                                    ast::BinaryPart::CallExpressionKw(Box::new(distance_call)),
                                                    ast::BinaryPart::try_from(labeled_arg.arg.clone())?,
                                                ),
                                            )),
                                            digest: None,
                                        },
                                    ));
                                    profile.sketch_block_body.push(length_stmt);

                                    // We only want to process the first
                                    // length/lengthX/lengthY arg, so break
                                    // after this.
                                    break;
                                }

                                // If the start point was not a literal Point2d,
                                // create start point coincident constraint.
                                if let Some(start_position) = profile.position.take()
                                    && is_free_point2d(&start_position).is_none()
                                {
                                    // Define the point.
                                    let point_name =
                                        next_free_name("point", &context.defined_names, call.as_source_ranges())?;
                                    let point_call = ast::Expr::CallExpressionKw(Box::new(ast::CallExpressionKw::new(
                                        "point",
                                        None,
                                        vec![ast::LabeledArg {
                                            label: Some(ast::Identifier::new("at")),
                                            arg: start_position,
                                        }],
                                    )));
                                    let point_stmt = ast::BodyItem::VariableDeclaration(ast::Node::boxed(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::VariableDeclaration::new(
                                            ast::VariableDeclarator::new(point_name.as_str(), point_call),
                                            ItemVisibility::Default,
                                            VariableKind::Const,
                                        ),
                                    ));
                                    profile.sketch_block_body.push(point_stmt);

                                    let coincident_call = ast::CallExpressionKw::new(
                                        "coincident",
                                        Some(array2_ast(
                                            ast::Expr::Name(Box::new(ast::Name::new(point_name.as_str()))),
                                            name_dot_name_ast(&name, "start"),
                                        )),
                                        Default::default(),
                                    );
                                    let coincident_stmt = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::ExpressionStatement {
                                            expression: ast::Expr::CallExpressionKw(Box::new(coincident_call)),
                                            digest: None,
                                        },
                                    ));
                                    profile.sketch_block_body.push(coincident_stmt);
                                }

                                // If we have a previous segment in the profile,
                                // create a coincident constraint between the
                                // end of the previous segment and the start of
                                // this one.
                                if let Some(previous_segment) = profile.previous_segment_name.take() {
                                    let coincident_call = ast::CallExpressionKw::new(
                                        "coincident",
                                        Some(array2_ast(
                                            name_dot_name_ast(&previous_segment, "end"),
                                            name_dot_name_ast(&name, "start"),
                                        )),
                                        Default::default(),
                                    );
                                    let coincident_stmt = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::ExpressionStatement {
                                            expression: ast::Expr::CallExpressionKw(Box::new(coincident_call)),
                                            digest: None,
                                        },
                                    ));
                                    profile.sketch_block_body.push(coincident_stmt);
                                }

                                if profile.first_segment_name.is_none() {
                                    profile.first_segment_name = Some(name.clone());
                                }
                                profile.previous_segment_name = Some(name.clone());
                            }
                        }
                        "close" => {
                            // We're closing a profile.
                            if let Some(mut profile) = profile.take() {
                                // If we have a previous segment and first
                                // segment in the profile, create a coincident
                                // constraint between the end of the previous
                                // segment and the start of the first one.
                                if let Some(previous_segment) = profile.previous_segment_name.take()
                                    && let Some(first_segment) = &profile.first_segment_name
                                    && previous_segment != *first_segment
                                {
                                    let coincident_call = ast::CallExpressionKw::new(
                                        "coincident",
                                        Some(array2_ast(
                                            name_dot_name_ast(&previous_segment, "end"),
                                            name_dot_name_ast(first_segment, "start"),
                                        )),
                                        Default::default(),
                                    );
                                    let coincident_stmt = ast::BodyItem::ExpressionStatement(ast::Node::new_node(
                                        Default::default(),
                                        Default::default(),
                                        Default::default(),
                                        ast::ExpressionStatement {
                                            expression: ast::Expr::CallExpressionKw(Box::new(coincident_call)),
                                            digest: None,
                                        },
                                    ));
                                    profile.sketch_block_body.push(coincident_stmt);
                                }

                                match profile.surface {
                                    Some((surface, face)) => {
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
                                                    arg: surface.clone(),
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
                                        sketch_block_value = Some(SketchBlockValue {
                                            name: name.clone(),
                                            surface: Some((surface, face)),
                                            segment_names: profile.segment_names.clone(),
                                        });
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

                            if let Some(sketch_block_value) = &mut sketch_block_value {
                                let first_segment_name = sketch_block_value.segment_names.first().ok_or_else(|| {
                                    KclError::new_internal(KclErrorDetails::new(
                                        "Expected at least one segment in sketch block".to_owned(),
                                        call.as_source_ranges(),
                                    ))
                                })?;
                                let second_segment_name = sketch_block_value.segment_names.get(1).ok_or_else(|| {
                                    KclError::new_internal(KclErrorDetails::new(
                                        "Expected at least two segments in sketch block for extrusion".to_owned(),
                                        call.as_source_ranges(),
                                    ))
                                })?;
                                let region_name =
                                    next_free_name("region", &context.defined_names, call.as_source_ranges())?;
                                let region_call = ast::Expr::CallExpressionKw(Box::new(ast::CallExpressionKw::new(
                                    "region",
                                    None,
                                    vec![ast::LabeledArg {
                                        label: Some(ast::Identifier::new("segments")),
                                        arg: array2_ast(
                                            name_dot_name_ast(sketch_block_value.name.clone(), first_segment_name),
                                            name_dot_name_ast(sketch_block_value.name.clone(), second_segment_name),
                                        ),
                                    }],
                                )));
                                let region_stmt = ast::BodyItem::VariableDeclaration(ast::Node::boxed(
                                    Default::default(),
                                    Default::default(),
                                    Default::default(),
                                    ast::VariableDeclaration::new(
                                        ast::VariableDeclarator::new(region_name.as_str(), region_call),
                                        ItemVisibility::Default,
                                        VariableKind::Const,
                                    ),
                                ));
                                context.new_declarations.push(region_stmt);

                                let mut new_extrude_call = *call.clone();
                                new_extrude_call.unlabeled =
                                    Some(ast::Expr::Name(Box::new(ast::Name::new(region_name.as_str()))));

                                if return_expr.is_some() {
                                    return Err(KclError::new_internal(KclErrorDetails::new(
                                        "I don't know how to handle multiple extrudes in a single pipeline".to_owned(),
                                        call.as_source_ranges(),
                                    )));
                                }
                                return_expr = Some(new_extrude_call);
                            }
                        }
                        _ => {
                            return Err(KclError::new_internal(KclErrorDetails::new(
                                format!("Found unrecognized call in pipeline: {}", &call.callee.name.name),
                                call.as_source_ranges(),
                            )));
                        }
                    }
                }

                migrate_expr(context, expr)?;
            }
            if let Some(return_expr) = return_expr {
                // If we had an extrude call, return the result of that instead
                // of the original pipeline.
                *expr = ast::Expr::CallExpressionKw(Box::new(return_expr));
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

fn is_free_point2d(expr: &ast::Expr) -> Option<(&ast::Expr, &ast::Expr)> {
    let ast::Expr::ArrayExpression(array_expr) = expr else {
        return None;
    };
    let [x, y] = array_expr.elements.as_slice() else {
        return None;
    };
    if matches!(x, ast::Expr::Name(_)) && matches!(y, ast::Expr::Name(_)) {
        Some((x, y))
    } else {
        None
    }
}

fn name_dot_name_ast<S: AsRef<str>>(name: S, property: &str) -> ast::Expr {
    ast::Expr::MemberExpression(ast::Node::boxed(
        Default::default(),
        Default::default(),
        Default::default(),
        ast::MemberExpression {
            object: ast::Expr::Name(Box::new(ast::Name::new(name.as_ref()))),
            property: ast::Expr::Name(Box::new(ast::Name::new(property))),
            computed: false,
            digest: None,
        },
    ))
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

fn point2d_ast(x: ast::Expr, y: ast::Expr) -> ast::Expr {
    array2_ast(x, y)
}

fn array2_ast(x: ast::Expr, y: ast::Expr) -> ast::Expr {
    ast::Expr::ArrayExpression(ast::Node::boxed(
        Default::default(),
        Default::default(),
        Default::default(),
        ast::ArrayExpression {
            elements: vec![x, y],
            non_code_meta: Default::default(),
            digest: None,
        },
    ))
}

fn sketch_var_ast(raw_value: &str, value: f64, suffix: NumericSuffix) -> ast::Expr {
    ast::Expr::SketchVar(ast::Node::boxed(
        Default::default(),
        Default::default(),
        Default::default(),
        ast::SketchVar {
            initial: Some(ast::Node::boxed(
                Default::default(),
                Default::default(),
                Default::default(),
                ast::NumericLiteral {
                    value,
                    suffix,
                    raw: raw_value.to_owned(),
                    digest: None,
                },
            )),
            digest: Default::default(),
        },
    ))
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
