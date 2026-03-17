use std::collections::{HashMap, HashSet};

use kcl_error::SourceRange;

use crate::{
    errors::{KclError, KclErrorDetails},
    front::find_defined_names,
    frontend::modify::next_free_name_with_padding,
    parsing::ast::types::{self as ast, CodeBlock, ItemVisibility, LabeledArg, VariableDeclarator, VariableKind},
};

/// Inserts `region()` calls when extruding a sketch block. This:
///
/// ```ignore
/// // comments
/// body1 = extrude(sketch1, foo)
/// ```
///
/// into
///
/// ```ignore
/// region1 = region(segments = [sketch1.line1, sketch1.line2])
/// // comments
/// body1 = extrude(region1, foo)
/// ```
pub(super) fn insert(program: &mut ast::Node<ast::Program>) -> Result<(), KclError> {
    let mut context = Context::default();
    migrate_program(&mut context, program)?;
    Ok(())
}

/// For the purposes of inserting regions, we only care whether something is a
/// sketch block or not.
#[derive(Debug, Clone)]
enum Ty {
    SketchBlock { seg1: String, seg2: String },
    Unknown,
}

#[derive(Debug, Clone, Default)]
struct Context {
    /// Environment of known variables and their type.
    env: HashMap<String, Ty>,
    /// When transpiling an expression, we may need to introduce new variable
    /// declarations. We can store those here and add them to the program after
    /// transpiling the expression.
    new_declarations: Vec<ast::BodyItem>,
    /// The set of names that are currently defined in the scope we're
    /// transpiling.
    defined_names: HashSet<String>,
}

impl Context {
    fn typ(&self, name: &str) -> &Ty {
        self.env.get(name).unwrap_or(&Ty::Unknown)
    }

    fn bind(&mut self, name: String, ty: Ty) {
        self.env.insert(name, ty);
    }
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
    context.defined_names = previous_defined_names;

    Ok(())
}

fn migrate_body_item(context: &mut Context, item: &mut ast::BodyItem) -> Result<(), KclError> {
    match item {
        ast::BodyItem::ImportStatement(_) => {}
        ast::BodyItem::ExpressionStatement(node) => {
            migrate_expr(context, &mut node.expression)?;
        }
        ast::BodyItem::VariableDeclaration(node) => {
            let ty = migrate_expr(context, &mut node.declaration.init)?;
            context.bind(node.name().to_owned(), ty);
        }
        ast::BodyItem::TypeDeclaration(_) => {}
        ast::BodyItem::ReturnStatement(node) => {
            migrate_expr(context, &mut node.argument)?;
        }
    }
    Ok(())
}

/// Returns true if a pipe was extracted and the caller should clear the
/// comments on the passed in node. In this case, the comments from the context
/// will have been moved to the new node.
fn migrate_expr(context: &mut Context, expr: &mut ast::Expr) -> Result<Ty, KclError> {
    match expr {
        ast::Expr::Literal(_) => Ok(Ty::Unknown),
        ast::Expr::Name(_) => Ok(Ty::Unknown),
        ast::Expr::TagDeclarator(_) => Ok(Ty::Unknown),
        ast::Expr::BinaryExpression(node) => {
            migrate_binary_expr(context, &mut node.left)?;
            migrate_binary_expr(context, &mut node.right)?;
            Ok(Ty::Unknown)
        }
        ast::Expr::FunctionExpression(node) => {
            migrate_block(context, &mut node.body)?;
            Ok(Ty::Unknown)
        }
        ast::Expr::CallExpressionKw(node) => {
            migrate_call(context, node)?;
            Ok(Ty::Unknown)
        }
        ast::Expr::PipeExpression(node) => {
            let mut ty = Ty::Unknown;
            for expr in node.body.iter_mut() {
                ty = migrate_expr(context, expr)?;
            }
            Ok(ty)
        }
        ast::Expr::PipeSubstitution(_) => Ok(Ty::Unknown),
        ast::Expr::ArrayExpression(node) => {
            for elem in &mut node.elements {
                migrate_expr(context, elem)?;
            }
            Ok(Ty::Unknown)
        }
        ast::Expr::ArrayRangeExpression(node) => {
            migrate_expr(context, &mut node.start_element)?;
            migrate_expr(context, &mut node.end_element)?;
            Ok(Ty::Unknown)
        }
        ast::Expr::ObjectExpression(node) => {
            for prop in &mut node.properties {
                migrate_expr(context, &mut prop.value)?;
            }
            Ok(Ty::Unknown)
        }
        ast::Expr::MemberExpression(node) => {
            migrate_expr(context, &mut node.object)?;
            migrate_expr(context, &mut node.property)?;
            Ok(Ty::Unknown)
        }
        ast::Expr::UnaryExpression(node) => {
            migrate_binary_expr(context, &mut node.argument)?;
            Ok(Ty::Unknown)
        }
        ast::Expr::IfExpression(node) => {
            migrate_expr(context, &mut node.cond)?;
            migrate_block(context, &mut *node.then_val)?;
            for else_if in &mut node.else_ifs {
                migrate_expr(context, &mut else_if.cond)?;
                migrate_block(context, &mut *else_if.then_val)?;
            }
            migrate_block(context, &mut *node.final_else)?;
            Ok(Ty::Unknown)
        }
        ast::Expr::LabelledExpression(node) => migrate_expr(context, &mut node.expr),
        ast::Expr::AscribedExpression(node) => {
            migrate_expr(context, &mut node.expr)?;
            Ok(Ty::Unknown)
        }
        ast::Expr::SketchBlock(sketch_block) => {
            let mut vars = Vec::with_capacity(2);
            for item in sketch_block.body.body() {
                if let ast::BodyItem::VariableDeclaration(var_decl) = item {
                    vars.push(var_decl.name().to_owned());
                    if vars.len() == 2 {
                        break;
                    }
                }
            }
            if let Ok([seg1, seg2]) = <[String; 2]>::try_from(vars) {
                Ok(Ty::SketchBlock { seg1, seg2 })
            } else {
                Ok(Ty::Unknown)
            }
        }
        ast::Expr::SketchVar(_) => Ok(Ty::Unknown),
        ast::Expr::None(_) => Ok(Ty::Unknown),
    }
}

/// Returns true if the call's unlabeled arg is a sketch block.
fn is_unlabeled_sketch_block(
    context: &Context,
    call: &ast::Node<ast::CallExpressionKw>,
) -> Option<(String, String, String)> {
    let Some(ast::Expr::Name(name)) = &call.unlabeled else {
        return None;
    };
    let name = &name.name.name;
    if let Ty::SketchBlock { seg1, seg2 } = context.typ(name) {
        Some((name.to_owned(), seg1.clone(), seg2.clone()))
    } else {
        None
    }
}

fn migrate_call(context: &mut Context, node: &mut ast::Node<ast::CallExpressionKw>) -> Result<(), KclError> {
    let range = SourceRange::from(&*node);
    let callee_name = node.callee.name.name.as_ref();
    match callee_name {
        "extrude" | "revolve" | "sweep" | "loft" => {
            // If call has an explicit unlabeled arg that we know is a sketch
            // block, create a new region() call assigned to a new variable, and
            // replace the unlabeled arg with that.
            if let Some((sketch_name, seg1, seg2)) = is_unlabeled_sketch_block(context, node) {
                // Generate a variable name for the region.
                let region_name = next_free_name("region", &context.defined_names, vec![range])?;
                // Track the new identifier as defined.
                context.defined_names.insert(region_name.clone());

                // Create the region call and assign it to the variable.
                let region_call = ast::Expr::CallExpressionKw(Box::new(ast::CallExpressionKw::new(
                    "region",
                    None,
                    vec![LabeledArg {
                        label: Some(ast::Identifier::new("segments")),
                        arg: ast::Expr::ArrayExpression(Box::new(ast::ArrayExpression::new(vec![
                            name_dot_name_ast(sketch_name.clone(), seg1),
                            name_dot_name_ast(sketch_name, seg2),
                        ]))),
                    }],
                )));
                let var_decl = ast::Node::boxed(
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    ast::VariableDeclaration::new(
                        VariableDeclarator::new(&region_name, region_call),
                        ItemVisibility::Default,
                        VariableKind::Const,
                    ),
                );
                // Insert before the current statement.
                context
                    .new_declarations
                    .push(ast::BodyItem::VariableDeclaration(var_decl));
                // Replace the unlabeled arg with the name of the region.
                node.unlabeled = Some(ast::Expr::Name(Box::new(ast::Name::new(&region_name))));
            }
        }
        _ => {}
    }

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

fn name_dot_name_ast<S1: Into<String>, S2: Into<String>>(name: S1, property: S2) -> ast::Expr {
    ast::Expr::MemberExpression(ast::Node::boxed(
        Default::default(),
        Default::default(),
        Default::default(),
        ast::MemberExpression {
            object: ast::Expr::Name(Box::new(ast::Name::new(name))),
            property: ast::Expr::Name(Box::new(ast::Name::new(property))),
            computed: false,
            digest: None,
        },
    ))
}
