use std::collections::HashSet;

use anyhow::Result;
use kcl_error::SourceRange;

use crate::{
    errors::Suggestion,
    lint::rule::{Discovered, Finding, def_finding},
    parsing::ast::types::{
        ArrayExpression, BodyItem, CallExpressionKw, Expr, Identifier, ImportSelector, ItemVisibility, Name,
        Node as AstNode, NodeList, PipeExpression, Program, VariableDeclaration, VariableDeclarator, VariableKind,
    },
    walk::Node,
};

def_finding!(
    Z0004,
    "profiles should not be chained",
    "\
Functions like startProfile, circle, ellipse, rectangle, polygon and others that start a new profile should not be chained together in a pipeline ✏️

When using multiple profile functions in a pipeline, only the last profile is returned. This can lead to unexpected results if earlier profiles are intended to contribute to the final shape.

Instead, try assigning the result of each profile to a variable and when extruding, use an array of those variables.
"
);

const NEW_VAR_PREFIX: &str = "profile";

pub fn lint_profiles_should_not_be_chained(node: Node, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    // It's called "Program", but it could be the body of a function. We'd like
    // to recurse into functions too, but how the linters get called would need
    // to change. So for now, only check the top-level program.
    if let Node::Program(program) = node
        && SourceRange::from(program) == prog.as_source_range()
    {
        return check_body(program, prog);
    };
    Ok(Vec::new())
}

fn check_body(block: &AstNode<Program>, whole_program: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let problematic_items = block
        .body
        .iter()
        .enumerate()
        .filter_map(|(item_index, body_item)| {
            let node = Node::from(body_item);
            let (unlabeled_arg, problematic_calls) = check_body_item_for_pipe(node);
            if problematic_calls.is_empty() {
                return None;
            }
            Some((item_index, unlabeled_arg, problematic_calls))
        })
        .collect::<Vec<_>>();
    if problematic_items.is_empty() {
        return Ok(Vec::new());
    }

    // Collect all the names bound in this scope. There may be more names
    // available from parent scopes, but we don't currently check for collisions
    // with those.
    let mut bound_names = find_defined_names(block);

    let mut discovered = Vec::new();
    for (item_index, mut unlabeled_arg, calls) in problematic_items {
        let mut new_program = whole_program.clone();
        let Some((first_call_index, pos)) = calls.first() else {
            continue;
        };
        // Break the pipeline at the first problematic call.
        let mut rest = split_off_pipe_at_index(&mut new_program.body[item_index], *first_call_index);

        if unlabeled_arg.is_none() {
            match previous_stage_result_expr(&mut new_program.body[item_index], &mut bound_names) {
                Ok(expr) => {
                    unlabeled_arg = Some(expr);
                }
                Err(err) => {
                    discovered.push(Err(err));
                    continue;
                }
            }
        }

        // Insert a new variable declaration for the problematic call.
        let new_var_name = match next_free_name(NEW_VAR_PREFIX, &bound_names) {
            Ok(name) => {
                bound_names.insert(name.clone());
                name
            }
            Err(err) => {
                discovered.push(Err(err));
                continue;
            }
        };

        // Copy the unlabeled arg from the previous call to the problematic
        // call since it's no longer in the pipeline. Create a new pipeline
        // if there's more than one expression left.
        let next_expr = if rest.len() == 1 {
            let mut call = rest.pop().unwrap();
            add_unlabeled_arg_to_call(&mut call, unlabeled_arg);
            call
        } else {
            add_unlabeled_arg_to_first_call(&mut rest, unlabeled_arg);
            Expr::PipeExpression(Box::new(PipeExpression::new(rest)))
        };

        new_program.body.insert(
            item_index + 1,
            BodyItem::VariableDeclaration(Box::new(AstNode::no_src(VariableDeclaration::new(
                VariableDeclarator::new(&new_var_name, next_expr),
                ItemVisibility::Default,
                VariableKind::Const,
            )))),
        );
        let next_item_index = item_index + 2;
        if new_program.body.len() > next_item_index {
            // If the next item is an extrude call, add the new variable to
            // its unlabeled argument.
            let next_item = &mut new_program.body[next_item_index];
            add_variable_to_extrude(next_item, &new_var_name);
        }
        // Format the code.
        let new_source = new_program.recast_top(&Default::default(), 0);
        let suggestion = Some(Suggestion {
            title: "Use separate profile variables and handle them all using an array.".to_owned(),
            insert: new_source,
            source_range: new_program.as_source_range(),
        });
        let finding = Z0004.at(
            "Profiles should not be chained together in a pipeline.".to_owned(),
            *pos,
            suggestion,
        );
        discovered.push(Ok(finding));
    }

    let discovered = discovered.into_iter().collect::<Result<Vec<_>>>()?;
    Ok(discovered)
}

fn check_body_item_for_pipe(node: Node) -> (Option<Expr>, Vec<(usize, SourceRange)>) {
    match &node {
        Node::ExpressionStatement(expr_stmt) => check_pipe_item(Node::from(&expr_stmt.expression)),
        Node::VariableDeclaration(var_decl) => check_pipe_item(Node::from(&var_decl.declaration.init)),
        _ => (None, Vec::new()),
    }
}

fn check_pipe_item(node: Node) -> (Option<Expr>, Vec<(usize, SourceRange)>) {
    let Node::PipeExpression(pipe) = node else {
        return (None, Vec::new());
    };
    let mut profile_calls = pipe
        .body
        .iter()
        .enumerate()
        .filter_map(|(index, expr)| {
            let Expr::CallExpressionKw(call) = expr else {
                return None;
            };
            if is_name_profile_function(&call.callee) {
                Some((index, SourceRange::from(expr), call.unlabeled.clone()))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if profile_calls.is_empty() {
        return (None, Vec::new());
    }

    // safety: split_off(1) panics if &self is empty, but
    // that was already checked.
    let problematic_calls = profile_calls.split_off(1);
    let unlabeled = profile_calls.into_iter().next().and_then(|(_, _, unlabeled)| unlabeled);
    (
        unlabeled,
        problematic_calls.into_iter().map(|(i, pos, _)| (i, pos)).collect(),
    )
}

fn is_name_profile_function(name: &Name) -> bool {
    is_str_profile_function(&name.name.name) && (name.path.is_empty() || path_matches(&name.path, &["std", "sketch"]))
}

fn is_str_profile_function(name: &str) -> bool {
    matches!(
        name,
        "startProfile"
            | "circle"
            | "rectangle"
            | "polygon"
            | "ellipse"
            | "conic"
            | "parabolic"
            | "hyperbolic"
            | "elliptic"
    )
}

fn path_matches(path: &NodeList<Identifier>, expected: &[&str]) -> bool {
    if path.len() != expected.len() {
        return false;
    }
    for (identifier, s) in path.iter().zip(expected.iter()) {
        if identifier.name.as_str() != *s {
            return false;
        }
    }
    true
}

fn find_defined_names(block: &AstNode<Program>) -> HashSet<String> {
    let mut defined_names = HashSet::new();
    for item in &block.body {
        if let BodyItem::ImportStatement(import) = item {
            match &import.selector {
                ImportSelector::List { items } => {
                    for import_item in items {
                        if let Some(alias) = &import_item.alias {
                            defined_names.insert(alias.name.clone());
                        } else {
                            defined_names.insert(import_item.name.name.clone());
                        }
                    }
                }
                ImportSelector::Glob(_) => {}
                ImportSelector::None { .. } => {}
            }
            if let Some(module_name) = import.module_name() {
                defined_names.insert(module_name);
            }
        }
        if let BodyItem::VariableDeclaration(var_decl) = item {
            let decl = &var_decl.declaration;
            defined_names.insert(decl.id.name.clone());
        }
    }
    defined_names
}

fn next_free_name(prefix: &str, taken_names: &HashSet<String>) -> anyhow::Result<String> {
    let mut index = 1;
    // Give up if we can't find a free name after a lot of tries.
    while index < 10_000 {
        let candidate = format!("{prefix}{index}");
        if !taken_names.contains(&candidate) {
            return Ok(candidate);
        }
        index += 1;
    }
    Err(anyhow::anyhow!(
        "Could not find a free name with prefix '{prefix}' after many tries."
    ))
}

fn split_off_pipe_at_index(item: &mut BodyItem, first_call_index: usize) -> Vec<Expr> {
    if let BodyItem::ExpressionStatement(expr_stmt) = item {
        return split_off_pipe_at_index_expr(&mut expr_stmt.expression, first_call_index);
    };
    if let BodyItem::VariableDeclaration(var_decl) = item {
        return split_off_pipe_at_index_expr(&mut var_decl.declaration.init, first_call_index);
    };
    Vec::new()
}

fn split_off_pipe_at_index_expr(expr: &mut Expr, first_call_index: usize) -> Vec<Expr> {
    let Expr::PipeExpression(pipe) = expr else {
        return Vec::new();
    };
    pipe.body.split_off(first_call_index)
}

fn previous_stage_result_expr(
    item: &mut BodyItem,
    bound_names: &mut HashSet<String>,
) -> anyhow::Result<Expr> {
    if let BodyItem::VariableDeclaration(var_decl) = item {
        let name = var_decl.declaration.id.name.clone();
        return Ok(Expr::Name(Box::new(Name::new(&name))));
    }
    if let BodyItem::ExpressionStatement(expr_stmt) = item {
        let new_name = next_free_name(NEW_VAR_PREFIX, bound_names)?;
        bound_names.insert(new_name.clone());
        let declaration = VariableDeclaration::new(
            VariableDeclarator::new(&new_name, expr_stmt.expression.clone()),
            ItemVisibility::Default,
            VariableKind::Const,
        );
        *item = BodyItem::VariableDeclaration(Box::new(AstNode::no_src(declaration)));
        return Ok(Expr::Name(Box::new(Name::new(&new_name))));
    }
    Err(anyhow::anyhow!(
        "Profiles should only be linted in expressions or variable declarations"
    ))
}

fn add_unlabeled_arg_to_first_call(exprs: &mut [Expr], unlabeled_arg: Option<Expr>) {
    if exprs.is_empty() {
        return;
    }
    if let Some(expr) = exprs.first_mut() {
        add_unlabeled_arg_to_call(expr, unlabeled_arg);
    }
}

fn add_unlabeled_arg_to_call(expr: &mut Expr, unlabeled_arg: Option<Expr>) {
    let Expr::CallExpressionKw(call) = expr else {
        return;
    };
    if call.unlabeled.is_none() {
        if let Some(arg) = unlabeled_arg {
            call.unlabeled = Some(arg);
        }
    }
}

fn add_variable_to_extrude(next_item: &mut BodyItem, new_var_name: &str) {
    if let BodyItem::ExpressionStatement(expr_stmt) = next_item {
        let Expr::CallExpressionKw(call) = &mut expr_stmt.expression else {
            return;
        };
        add_variable_to_extrude_call(call, new_var_name);
    }
    if let BodyItem::VariableDeclaration(var_decl) = next_item {
        let Expr::CallExpressionKw(call) = &mut var_decl.declaration.init else {
            return;
        };
        add_variable_to_extrude_call(call, new_var_name);
    }
}

fn add_variable_to_extrude_call(call: &mut CallExpressionKw, new_var_name: &str) {
    if !is_name_extrude_function(&call.callee) {
        return;
    }
    if let Some(unlabeled) = &mut call.unlabeled {
        match unlabeled {
            Expr::ArrayExpression(array) => {
                array.elements.push(Expr::Name(Box::new(Name::new(new_var_name))));
            }
            _ => {
                let first = unlabeled.clone();
                let new_array = vec![first, Expr::Name(Box::new(Name::new(new_var_name)))];
                *unlabeled = Expr::ArrayExpression(Box::new(ArrayExpression::new(new_array)));
            }
        }
    }
}

fn is_name_extrude_function(name: &Name) -> bool {
    ["extrude", "revolve"].contains(&name.name.name.as_str())
        && (name.path.is_empty() || path_matches(&name.path, &["std", "sketch"]))
}

#[cfg(test)]
mod tests {
    use super::{Z0004, lint_profiles_should_not_be_chained};
    use crate::lint::rule::{test_finding, test_no_finding};

    test_finding!(
        z0004_bad_circles_extrude_without_var,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [0, 0], radius = 5)
  |> circle(center = [0, 0], radius = 5)
extrude(profile1, length = 1)
",
        "Profiles should not be chained together in a pipeline.",
        Some(
            "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [0, 0], radius = 5)
profile2 = circle(sketch1, center = [0, 0], radius = 5)
extrude([profile1, profile2], length = 1)
"
            .to_owned()
        )
    );

    test_finding!(
        z0004_bad_circles_revolve_without_var,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [0, 0], radius = 5)
  |> circle(center = [0, 0], radius = 5)
revolve(profile1, axis = Z)
",
        "Profiles should not be chained together in a pipeline.",
        Some(
            "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [0, 0], radius = 5)
profile2 = circle(sketch1, center = [0, 0], radius = 5)
revolve([profile1, profile2], axis = Z)
"
            .to_owned()
        )
    );

    test_finding!(
        z0004_bad_circles_extrude_with_var,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [0, 0], radius = 5)
  |> circle(center = [0, 0], radius = 5)
solid1 = extrude(profile1, length = 1)
",
        "Profiles should not be chained together in a pipeline.",
        Some(
            "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [0, 0], radius = 5)
profile2 = circle(sketch1, center = [0, 0], radius = 5)
solid1 = extrude([profile1, profile2], length = 1)
"
            .to_owned()
        )
    );

    // We don't currently fix multiple chained profiles at once. But as soon as
    // it's fixed, the next one will be found.
    test_finding!(
        z0004_many_bad_circles_extrude,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [1, 1], radius = 5)
  |> circle(center = [2, 2], radius = 5)
  |> circle(center = [3, 3], radius = 5)
extrude(profile1, length = 1)
",
        "Profiles should not be chained together in a pipeline.",
        Some(
            "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [1, 1], radius = 5)
profile2 = circle(sketch1, center = [2, 2], radius = 5)
  |> circle(center = [3, 3], radius = 5)
extrude([profile1, profile2], length = 1)
"
            .to_owned()
        )
    );

    test_no_finding!(
        z0004_good_circles,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [0, 0], radius = 5)
profile2 = circle(sketch1, center = [0, 0], radius = 5)
extrude([profile1, profile2], length = 1)
"
    );

    test_finding!(
        z0004_bad_circles_extrude_with_comment_in_middle,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
// First circle.
profile1 = circle(sketch1, center = [0, 0], radius = 5)
// Second circle.
  |> circle(center = [0, 0], radius = 5)
extrude(profile1, length = 1)
",
        "Profiles should not be chained together in a pipeline.",
        Some(
            "\
sketch1 = startSketchOn(XY)
// First circle.
profile1 = circle(sketch1, center = [0, 0], radius = 5)
  // Second circle.
profile2 = circle(sketch1, center = [0, 0], radius = 5)
extrude([profile1, profile2], length = 1)
"
            .to_owned()
        )
    );

    test_finding!(
        z0004_start_profile_then_circle,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], radius = 5)
",
        "Profiles should not be chained together in a pipeline.",
        Some(
            "\
sketch1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
profile1 = circle(sketch1, center = [0, 0], radius = 5)
"
            .to_owned()
        )
    );
}
