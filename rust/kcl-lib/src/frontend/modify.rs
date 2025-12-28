use std::collections::HashSet;

use crate::parsing::ast::types::{BinaryPart, BodyItem, CodeBlock, Expr, ImportSelector};

/// Find all defined names in the given code block. This ignores names defined
/// by glob imports.
pub(crate) fn find_defined_names<B: CodeBlock>(block: &B) -> HashSet<String> {
    let mut defined_names = HashSet::new();
    for item in block.body() {
        match item {
            BodyItem::ImportStatement(import) => {
                match &import.selector {
                    ImportSelector::List { items } => {
                        for import_item in items {
                            defined_names.insert(import_item.identifier().to_owned());
                        }
                    }
                    ImportSelector::Glob(_) => {}
                    ImportSelector::None { .. } => {}
                }
                if let Some(module_name) = import.module_name() {
                    defined_names.insert(module_name);
                }
            }
            BodyItem::ExpressionStatement(expr_stmt) => {
                find_defined_names_expr(&expr_stmt.expression, &mut defined_names);
            }
            BodyItem::VariableDeclaration(var_decl) => {
                find_defined_names_expr(&var_decl.declaration.init, &mut defined_names);
                let decl = &var_decl.declaration;
                defined_names.insert(decl.id.name.clone());
            }
            BodyItem::TypeDeclaration(type_decl) => {
                defined_names.insert(type_decl.name.name.clone());
            }
            BodyItem::ReturnStatement(ret_stmt) => {
                find_defined_names_expr(&ret_stmt.argument, &mut defined_names);
            }
        }
    }
    defined_names
}

fn find_defined_names_expr(expr: &Expr, defined_names: &mut HashSet<String>) {
    match expr {
        Expr::CallExpressionKw(call) => {
            for (_, arg) in call.iter_arguments() {
                find_defined_names_expr(arg, defined_names);
            }
        }
        Expr::PipeExpression(pipe) => {
            for expr in &pipe.body {
                find_defined_names_expr(expr, defined_names);
            }
        }
        Expr::LabelledExpression(labeled) => {
            find_defined_names_expr(&labeled.expr, defined_names);
            defined_names.insert(labeled.label.name.clone());
        }
        Expr::Literal(_) => {}
        Expr::Name(_) => {}
        Expr::TagDeclarator(tag_decl) => {
            defined_names.insert(tag_decl.name.clone());
        }
        Expr::BinaryExpression(bin_expr) => {
            find_defined_names_binary_part(&bin_expr.left, defined_names);
            find_defined_names_binary_part(&bin_expr.right, defined_names);
        }
        Expr::FunctionExpression(func) => {
            if let Some(name) = &func.name {
                defined_names.insert(name.name.to_owned());
            }
        }
        Expr::PipeSubstitution(_) => {}
        Expr::ArrayExpression(array) => {
            for element in &array.elements {
                find_defined_names_expr(element, defined_names);
            }
        }
        Expr::ArrayRangeExpression(range) => {
            find_defined_names_expr(&range.start_element, defined_names);
            find_defined_names_expr(&range.end_element, defined_names);
        }
        Expr::ObjectExpression(obj) => {
            for property in &obj.properties {
                find_defined_names_expr(&property.value, defined_names);
            }
        }
        Expr::MemberExpression(member) => {
            find_defined_names_expr(&member.object, defined_names);
            find_defined_names_expr(&member.property, defined_names);
        }
        Expr::UnaryExpression(unary_expr) => {
            find_defined_names_binary_part(&unary_expr.argument, defined_names);
        }
        Expr::IfExpression(if_expr) => {
            find_defined_names_expr(&if_expr.cond, defined_names);
            for else_if in &if_expr.else_ifs {
                find_defined_names_expr(&else_if.cond, defined_names);
            }
        }
        Expr::AscribedExpression(expr) => {
            find_defined_names_expr(&expr.expr, defined_names);
        }
        Expr::SketchBlock(sketch_block) => {
            for labeled_arg in &sketch_block.arguments {
                find_defined_names_expr(&labeled_arg.arg, defined_names);
            }
        }
        Expr::SketchVar(_) => {}
        Expr::None(_) => {}
    }
}

fn find_defined_names_binary_part(expr: &BinaryPart, defined_names: &mut HashSet<String>) {
    match expr {
        BinaryPart::Literal(_) => {}
        BinaryPart::Name(_) => {}
        BinaryPart::BinaryExpression(binary_expr) => {
            find_defined_names_binary_part(&binary_expr.left, defined_names);
            find_defined_names_binary_part(&binary_expr.right, defined_names);
        }
        BinaryPart::CallExpressionKw(call) => {
            for (_, arg) in call.iter_arguments() {
                find_defined_names_expr(arg, defined_names);
            }
        }
        BinaryPart::UnaryExpression(unary_expr) => {
            find_defined_names_binary_part(&unary_expr.argument, defined_names);
        }
        BinaryPart::MemberExpression(member) => {
            find_defined_names_expr(&member.object, defined_names);
            find_defined_names_expr(&member.property, defined_names);
        }
        BinaryPart::ArrayExpression(array) => {
            for element in &array.elements {
                find_defined_names_expr(element, defined_names);
            }
        }
        BinaryPart::ArrayRangeExpression(range) => {
            find_defined_names_expr(&range.start_element, defined_names);
            find_defined_names_expr(&range.end_element, defined_names);
        }
        BinaryPart::ObjectExpression(obj) => {
            for property in &obj.properties {
                find_defined_names_expr(&property.value, defined_names);
            }
        }
        BinaryPart::IfExpression(if_expr) => {
            find_defined_names_expr(&if_expr.cond, defined_names);
            for else_if in &if_expr.else_ifs {
                find_defined_names_expr(&else_if.cond, defined_names);
            }
        }
        BinaryPart::AscribedExpression(expr) => {
            find_defined_names_expr(&expr.expr, defined_names);
        }
        BinaryPart::SketchVar(_) => {}
    }
}

pub(super) fn next_free_name(prefix: &str, taken_names: &HashSet<String>) -> anyhow::Result<String> {
    next_free_name_using_max(prefix, taken_names, 999)
}

pub(crate) fn next_free_name_using_max(
    prefix: &str,
    taken_names: &HashSet<String>,
    mut max: u16,
) -> anyhow::Result<String> {
    if max == u16::MAX {
        // Prevent overflow.
        max = u16::MAX - 1;
    }
    let mut index = 1;
    while index <= max {
        let candidate = format!("{prefix}{index}");
        if !taken_names.contains(&candidate) {
            return Ok(candidate);
        }
        index += 1;
    }
    Err(anyhow::anyhow!(
        "Could not find a free name with prefix '{prefix}' after maximum tries."
    ))
}
