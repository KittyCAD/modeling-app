use std::collections::HashSet;

use anyhow::Result;
use kcl_error::SourceRange;

use crate::{
    errors::Suggestion,
    front::{find_defined_names, next_free_name_using_max},
    lint::rule::{Discovered, Finding, FindingFamily, def_finding},
    parsing::ast::types::{
        ArrayExpression, BodyItem, CallExpressionKw, Expr, ItemVisibility, Name, Node as AstNode, PipeExpression,
        Program, VariableDeclaration, VariableDeclarator, VariableKind,
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
",
FindingFamily::Correctness
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
    let bound_names = find_defined_names(block);

    let discovered = problematic_items
        .into_iter()
        .flat_map(|(item_index, unlabeled_arg, calls)| {
            let mut new_program = whole_program.clone();
            let Some((first_call_index, pos)) = calls.first() else {
                return Vec::new();
            };
            // Break the pipeline at the first problematic call.
            let mut rest = split_off_pipe_at_index(&mut new_program.body[item_index], *first_call_index);
            // Copy the unlabeled arg from the previous call to the problematic
            // call since it's no longer in the pipeline. Create a new pipeline
            // if there's more than one expression left.
            let (next_expr, result) = if rest.len() == 1
                && let Some(mut call) = rest.pop()
            {
                let result = add_unlabeled_arg_to_call(&mut call, unlabeled_arg);
                (call, result)
            } else {
                let result = add_unlabeled_arg_to_first_call(&mut rest, unlabeled_arg);
                (Expr::PipeExpression(Box::new(PipeExpression::new(rest))), result)
            };
            if result.is_err() {
                // We needed an unlabeled arg, but we don't have one. We aren't
                // currently smart enough to suggest a fix.
                return vec![Ok(Z0004.at(
                    "Profiles should not be chained together in a pipeline.".to_owned(),
                    *pos,
                    None,
                ))];
            }

            // Insert a new variable declaration for the problematic call.
            let new_var_name = match next_free_name(NEW_VAR_PREFIX, &bound_names) {
                Ok(name) => name,
                Err(err) => return vec![Err(err)],
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
            let found_extrusion = if new_program.body.len() > next_item_index {
                // If the next item is an extrude call, add the new variable to
                // its unlabeled argument.
                let next_item = &mut new_program.body[next_item_index];
                add_variable_to_extrude(next_item, &new_var_name)
            } else {
                false
            };
            // Format the code.
            let new_source = new_program.recast_top(&Default::default(), 0);
            let suggestion = Some(Suggestion {
                title: if found_extrusion {
                    "Use separate profile variables and refer to them using an array.".to_owned()
                } else {
                    "Use separate profile variables.".to_owned()
                },
                insert: new_source,
                source_range: new_program.as_source_range(),
            });
            let discovered = Z0004.at(
                "Profiles should not be chained together in a pipeline.".to_owned(),
                *pos,
                suggestion,
            );
            vec![Ok(discovered)]
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(discovered)
}

fn check_body_item_for_pipe(node: Node) -> (Option<Expr>, Vec<(usize, SourceRange)>) {
    match &node {
        Node::ExpressionStatement(expr_stmt) => check_pipe_item(Node::from(&expr_stmt.expression)),
        Node::VariableDeclaration(var_decl) => {
            let (unlabeled, problematic) = check_pipe_item(Node::from(&var_decl.declaration.init));
            // If there is no unlabeled arg, use the variable defined for the
            // entire pipeline as the unlabeled arg.
            (
                unlabeled.or_else(|| {
                    Some(Expr::Name(Box::new(AstNode::<Name>::from(
                        var_decl.declaration.id.clone(),
                    ))))
                }),
                problematic,
            )
        }
        _ => (None, Vec::new()),
    }
}

/// Given a pipe expression node, return the unlabeled argument of the first
/// profile function call and a list of all subsequent problematic profile
/// function calls' {pipe body indices and source ranges}.
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

    // Filter out `startProfile()` calls with another profile function
    // immediately after it.
    let mut i = 0;
    // Check not empty so that the minus 1 doesn't underflow.
    while !profile_calls.is_empty() && i < profile_calls.len() - 1 {
        let Some((current_index, _, _)) = profile_calls.get(i) else {
            break;
        };
        let Some((next_index, _, _)) = profile_calls.get(i + 1) else {
            break;
        };
        if *next_index == *current_index + 1
            && let Some(Expr::CallExpressionKw(call)) = pipe.body.get(*current_index)
            && is_start_profile_function(&call.callee)
        {
            // Remove the current profile call from the list. It's useless, but
            // not actually problematic.
            profile_calls.remove(i);
            // Do not increment i, since everything has shifted left.
        } else {
            i += 1;
        }
    }

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

fn is_start_profile_function(name: &Name) -> bool {
    &name.name.name == "startProfile" && name.path.is_empty()
}

fn is_name_profile_function(name: &Name) -> bool {
    is_str_profile_function(&name.name.name) && name.path.is_empty()
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

fn next_free_name(prefix: &str, taken_names: &HashSet<String>) -> anyhow::Result<String> {
    next_free_name_using_max(prefix, taken_names, 10_000)
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

fn add_unlabeled_arg_to_first_call(exprs: &mut [Expr], unlabeled_arg: Option<Expr>) -> Result<(), ()> {
    if let Some(expr) = exprs.first_mut() {
        return add_unlabeled_arg_to_call(expr, unlabeled_arg);
    }
    Ok(())
}

/// Mutates the `Expr`'s call to have the given unlabeled arg if it needs it.
/// Returns an `Err` if the call needs an unlabeled arg but none is provided.
fn add_unlabeled_arg_to_call(expr: &mut Expr, unlabeled_arg: Option<Expr>) -> Result<(), ()> {
    let Expr::CallExpressionKw(call) = expr else {
        return Ok(());
    };
    if call.unlabeled.is_none() {
        if let Some(arg) = unlabeled_arg {
            // Add the unlabeled argument.
            call.unlabeled = Some(arg);
            Ok(())
        } else {
            // We need an unlabeled arg, but we don't have one.
            Err(())
        }
    } else {
        // It already has an explicit unlabeled arg.
        Ok(())
    }
}

fn add_variable_to_extrude(next_item: &mut BodyItem, new_var_name: &str) -> bool {
    if let BodyItem::ExpressionStatement(expr_stmt) = next_item {
        let Expr::CallExpressionKw(call) = &mut expr_stmt.expression else {
            return false;
        };
        return add_variable_to_extrude_call(call, new_var_name);
    }
    if let BodyItem::VariableDeclaration(var_decl) = next_item {
        let Expr::CallExpressionKw(call) = &mut var_decl.declaration.init else {
            return false;
        };
        return add_variable_to_extrude_call(call, new_var_name);
    }
    false
}

/// Add the variable to the unlabeled argument of an extrude or revolve call and
/// return true if successful.
fn add_variable_to_extrude_call(call: &mut CallExpressionKw, new_var_name: &str) -> bool {
    if !is_name_extrude_function(&call.callee) {
        return false;
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
        return true;
    }
    false
}

fn is_name_extrude_function(name: &Name) -> bool {
    ["extrude", "revolve"].contains(&name.name.name.as_str()) && name.path.is_empty()
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

    test_no_finding!(
        z0004_circle_after_start_profile_with_var,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], radius = 5)
extrude(sketch1, length = 1)
"
    );

    test_no_finding!(
        z0004_circle_after_start_profile_no_var,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], radius = 5)
  |> extrude(length = 1)
"
    );

    test_finding!(
        z0004_bad_circle_after_good_piped_circle_with_var,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 5)
  |> circle(center = [10, 0], radius = 5)
extrude(sketch1, length = 1)
",
        "Profiles should not be chained together in a pipeline.",
        Some(
            "\
sketch1 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 5)
profile1 = circle(sketch1, center = [10, 0], radius = 5)
extrude([sketch1, profile1], length = 1)
"
            .to_owned()
        )
    );

    // This is problematic, but we currently don't suggest a fix since we'd need
    // to create two variables.
    test_finding!(
        z0004_bad_circle_after_good_piped_circle_no_var,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
startSketchOn(XY)
  |> circle(center = [0, 0], radius = 5)
  |> circle(center = [10, 0], radius = 5)
  |> extrude(length = 1)
",
        "Profiles should not be chained together in a pipeline.",
        None
    );

    test_finding!(
        z0004_do_not_define_var_with_same_name_as_tag,
        lint_profiles_should_not_be_chained,
        Z0004,
        "\
sketch1 = startSketchOn(XY)
profile1 = circle(sketch1, center = [0, 0], radius = 5, tag = $profile2)
  |> circle(center = [10, 0], radius = 5)
extrude(profile1, length = 5)
",
        "Profiles should not be chained together in a pipeline.",
        Some(
            "\
sketch1 = startSketchOn(XY)
profile1 = circle(
       sketch1,
       center = [0, 0],
       radius = 5,
       tag = $profile2,
     )
profile3 = circle(sketch1, center = [10, 0], radius = 5)
extrude([profile1, profile3], length = 5)
"
            .to_owned()
        )
    );
}
