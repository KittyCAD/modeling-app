//! Conservative, cache-free execution of the first sketch in a solid helper.
//! Unsupported selection or dependencies leave the ordinary executor in charge.

use std::cell::Cell;
use std::collections::HashSet;

use crate::Program;
use crate::parsing::ast::types::BodyItem;
use crate::parsing::ast::types::CallExpressionKw;
use crate::parsing::ast::types::Expr;
use crate::parsing::ast::types::Name;
use crate::walk::Node;
use crate::walk::walk;

const SKETCH_CALLS: &[&str] = &[
    "line",
    "arc",
    "circle",
    "point",
    "coincident",
    "horizontal",
    "vertical",
    "tangent",
    "radius",
    "diameter",
    "distance",
    "horizontalDistance",
    "verticalDistance",
    "equalRadius",
    "equalLength",
    "parallel",
    "perpendicular",
    "fixed",
    "sin",
];

fn named(name: &Name, expected: &str) -> bool {
    name.path.is_empty() && !name.abs_path && name.name.name == expected
}

fn is_name(expr: &Expr, expected: &str) -> bool {
    matches!(expr, Expr::Name(name) if named(name, expected))
}

fn head_call(expr: &Expr) -> Option<&CallExpressionKw> {
    match expr {
        Expr::CallExpressionKw(call) => Some(call),
        Expr::PipeExpression(pipe) => head_call(pipe.body.first()?),
        _ => None,
    }
}

fn constant_argument(expr: &Expr, literal_names: &HashSet<&str>) -> bool {
    match expr {
        Expr::Literal(_) => true,
        Expr::Name(name) => name.path.is_empty() && !name.abs_path && literal_names.contains(name.name.name.as_str()),
        Expr::BinaryExpression(binary) => {
            constant_argument(&Expr::from(&binary.left), literal_names)
                && constant_argument(&Expr::from(&binary.right), literal_names)
        }
        Expr::UnaryExpression(unary) => constant_argument(&Expr::from(&unary.argument), literal_names),
        _ => false,
    }
}

/// Only direct calls with constant arguments are eligible, including arithmetic
/// on earlier literal constants. The ordinary executor still evaluates units.
/// Do not infer instance order through imports, aliases or callbacks.
pub fn first_instance(program: &Program, sketch_name: &str) -> Option<Program> {
    let mut helper = None;
    for item in &program.ast.body {
        let BodyItem::VariableDeclaration(decl) = item else {
            continue;
        };
        let Expr::FunctionExpression(function) = &decl.declaration.init else {
            continue;
        };
        let Some(BodyItem::VariableDeclaration(sketch)) = function.body.body.first() else {
            continue;
        };
        if sketch.declaration.id.name == sketch_name && matches!(sketch.declaration.init, Expr::SketchBlock(_)) {
            if helper.is_some() {
                return None;
            }
            helper = Some(decl);
        }
    }
    let helper = helper?;
    let helper_name = &helper.declaration.id.name;
    let Expr::FunctionExpression(function) = &helper.declaration.init else {
        return None;
    };
    // A local sketch returned as geometry could be transformed or cloned later.
    // Restrict this shortcut to helpers returning an extrusion, not the sketch.
    let (sketch, region, solid, hidden, returned) = match function.body.body.as_slice() {
        [
            BodyItem::VariableDeclaration(sketch),
            BodyItem::VariableDeclaration(solid),
            BodyItem::ExpressionStatement(hidden),
            BodyItem::ReturnStatement(returned),
        ] => (sketch, None, solid, hidden, returned),
        [
            BodyItem::VariableDeclaration(sketch),
            BodyItem::VariableDeclaration(region),
            BodyItem::VariableDeclaration(solid),
            BodyItem::ExpressionStatement(hidden),
            BodyItem::ReturnStatement(returned),
        ] => (sketch, Some(region), solid, hidden, returned),
        _ => return None,
    };
    let Expr::SketchBlock(block) = &sketch.declaration.init else {
        return None;
    };
    let [plane] = block.arguments.as_slice() else {
        return None;
    };
    if plane.label.as_ref()?.name != "on" || !["XY", "XZ", "YZ"].iter().any(|name| is_name(&plane.arg, name)) {
        return None;
    }
    let Expr::CallExpressionKw(extrusion) = &solid.declaration.init else {
        return None;
    };
    // Allow a named region feeding this extrusion, not arbitrary helper work.
    if let Some(region) = region {
        let Expr::CallExpressionKw(call) = &region.declaration.init else {
            return None;
        };
        if !named(&call.callee, "region")
            || !extrusion
                .unlabeled
                .as_ref()
                .is_some_and(|value| is_name(value, &region.declaration.id.name))
        {
            return None;
        }
    }
    let Expr::CallExpressionKw(hide) = &hidden.expression else {
        return None;
    };
    if !named(&extrusion.callee, "extrude")
        || !named(&hide.callee, "hide")
        || !hide.unlabeled.as_ref().is_some_and(|value| is_name(value, sketch_name))
        || !is_name(&returned.argument, &solid.declaration.id.name)
    {
        return None;
    }

    let mut literal_names = HashSet::new();
    let mut declared_names = HashSet::new();
    let mut selected_call = None;
    let mut direct_calls = 0;
    for (index, item) in program.ast.body.iter().enumerate() {
        if matches!(item, BodyItem::ReturnStatement(_)) {
            return None;
        }
        let BodyItem::VariableDeclaration(decl) = item else {
            continue;
        };
        let name = decl.declaration.id.name.as_str();
        if !declared_names.insert(name) {
            return None;
        }
        // Do not accidentally resolve a shadowed stdlib function or plane.
        if SKETCH_CALLS.contains(&name) || ["XY", "XZ", "YZ", "ORIGIN", "extrude", "region", "hide"].contains(&name) {
            return None;
        }
        if matches!(decl.declaration.init, Expr::Literal(_)) && selected_call.is_none() {
            literal_names.insert(name);
        }
        if let Some(call) = head_call(&decl.declaration.init)
            && named(&call.callee, helper_name)
        {
            direct_calls += 1;
            if selected_call.is_none() {
                if call.unlabeled.is_some()
                    || call.arguments.len() != function.params.len()
                    || !function.params.iter().all(|param| {
                        call.arguments.iter().any(|arg| {
                            arg.label
                                .as_ref()
                                .is_some_and(|label| label.name == param.identifier.name)
                        })
                    })
                    || !call
                        .arguments
                        .iter()
                        .all(|arg| constant_argument(&arg.arg, &literal_names))
                {
                    return None;
                }
                selected_call = Some(index);
            }
        }
    }
    let selected_call = selected_call?;
    let helper_references = Cell::new(0);
    let helper_declarations = Cell::new(0);
    let sketch_declarations = Cell::new(0);
    let safe = walk(&program.ast, |node| -> anyhow::Result<bool> {
        match node {
            Node::ImportStatement(_) => return Ok(false),
            Node::CallExpressionKw(call) if named(&call.callee, "exit") => return Ok(false),
            Node::Name(name) if named(name, helper_name) => helper_references.set(helper_references.get() + 1),
            Node::VariableDeclaration(decl) if decl.declaration.id.name == *helper_name => {
                helper_declarations.set(helper_declarations.get() + 1);
            }
            Node::VariableDeclaration(decl) if decl.declaration.id.name == sketch_name => {
                sketch_declarations.set(sketch_declarations.get() + 1);
            }
            _ => {}
        }
        Ok(true)
    })
    .ok()?;
    if !safe
        || helper_references.get() != direct_calls
        || helper_declarations.get() != 1
        || sketch_declarations.get() != 1
    {
        return None;
    }
    // The retained helper must not obtain geometry or values from other calls.
    // The normal executor still resolves every parameter, unit and constraint.
    let safe = walk(&function.body, |node| -> anyhow::Result<bool> {
        if let Node::CallExpressionKw(call) = node {
            return Ok(call.callee.path.is_empty()
                && !call.callee.abs_path
                && (SKETCH_CALLS.contains(&call.callee.name.name.as_str())
                    || ["extrude", "region", "hide"].contains(&call.callee.name.name.as_str())));
        }
        Ok(!matches!(node, Node::FunctionExpression(_) | Node::ImportStatement(_)))
    })
    .ok()?;
    if !safe {
        return None;
    }

    let mut isolated = program.clone();
    isolated.ast.body = program.ast.body[..=selected_call]
        .iter()
        .filter_map(|item| {
            let BodyItem::VariableDeclaration(decl) = item else {
                return None;
            };
            if decl.declaration.id.name == *helper_name {
                let mut helper = decl.clone();
                let Expr::FunctionExpression(function) = &mut helper.declaration.init else {
                    return None;
                };
                let BodyItem::VariableDeclaration(sketch) = &mut function.body.body[0] else {
                    return None;
                };
                let Expr::SketchBlock(block) = &mut sketch.declaration.init else {
                    return None;
                };
                // Reuse sketch-edit mode's existing whole-program exit after solve.
                block.is_being_edited = true;
                Some(BodyItem::VariableDeclaration(helper))
            } else if item == &program.ast.body[selected_call] {
                let mut invocation = decl.clone();
                if let Expr::PipeExpression(pipe) = &invocation.declaration.init {
                    invocation.declaration.init = pipe.body[0].clone();
                }
                Some(BodyItem::VariableDeclaration(invocation))
            } else if matches!(decl.declaration.init, Expr::Literal(_)) {
                Some(item.clone())
            } else {
                None
            }
        })
        .collect();
    Some(isolated)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: &str = r#"@settings(kclVersion = 2.0)
depth = 5mm
unrelated = sketch(on = XY) {
  edge = circle(center = [0mm, 0mm], start = [10mm, 0mm])
}
base = extrude(region(segments = [unrelated.edge]), length = depth)
fn makePad(r, depth) {
  profile = sketch(on = XY) {
    perimeter = circle(center = [0mm, 0mm], start = [var 3mm, var 0mm])
    radius(perimeter) == r
  }
  solid = extrude(region(segments = [profile.perimeter]), length = depth)
  hide(profile)
  return solid
}
first = makePad(r = 3mm, depth = depth)
  |> translate(xyz = [25mm, 0mm, 10mm], global = true)
copies = patternCircular3d(first, instances = 3, axis = Z, center = [0mm, 0mm, 0mm], arcDegrees = 360deg)
second = makePad(r = 7mm, depth = depth)
"#;

    #[test]
    fn first_instance_preserves_source_and_selects_original_call() {
        let full = Program::parse_no_errs(CODE).unwrap();
        let selected = first_instance(&full, "profile").unwrap();
        assert_eq!(selected.original_file_contents, CODE);
        assert_eq!(selected.ast.inner_attrs, full.ast.inner_attrs);
        assert_eq!(selected.ast.body.len(), 3);
        let BodyItem::VariableDeclaration(call) = selected.ast.body.last().unwrap() else {
            panic!()
        };
        assert_eq!(call.declaration.id.name, "first");
        assert!(matches!(call.declaration.init, Expr::CallExpressionKw(_)));
        assert!(first_instance(&full, "missing").is_none());
    }

    #[test]
    fn first_instance_accepts_only_a_region_feeding_the_extrusion() {
        let code = CODE.replace(
            "solid = extrude(region(segments = [profile.perimeter]), length = depth)",
            "outline = region(segments = [profile.perimeter])\n  solid = extrude(outline, length = depth)",
        );
        let program = Program::parse_no_errs(&code).unwrap();
        assert!(first_instance(&program, "profile").is_some());
        for unsupported in [
            code.replace("outline = region(", "outline = otherFunction("),
            code.replace("extrude(outline,", "extrude(otherOutline,"),
            code.replace("return solid", "return outline"),
            code.replace("outline = region(segments = [profile.perimeter])", "outline = profile"),
            code.replace("outline = region(segments = [profile.perimeter])", "outline = 1mm"),
            code.replace("length = depth)", "length = depth) |> translate(x = 1mm)"),
        ] {
            let program = Program::parse_no_errs(&unsupported).unwrap();
            assert!(first_instance(&program, "profile").is_none(), "accepted {unsupported}");
        }
    }

    #[test]
    fn first_instance_declines_unsafe_dependencies_or_selection() {
        for code in [
            format!("import x from \"helper.kcl\"\n{CODE}"),
            format!("{CODE}\nalias = makePad\n"),
            format!("exit()\n{CODE}"),
            format!("{CODE}\nfn nested() {{ return makePad(r = 2mm, depth = 1mm) }}\n"),
            CODE.replace(
                "profile = sketch(on = XY)",
                "profile = sketch(on = faceOf(base, face = END))",
            ),
            CODE.replace("return solid", "return profile"),
            CODE.replace("r = 3mm", "r = radius(unrelated.edge)"),
            CODE.replace("r = 3mm", "r = 1mm + radius(unrelated.edge)"),
            CODE.replace("r = 3mm", "r = depth + later"),
            CODE.replace("depth = 5mm", "depth = 2mm + 3mm"),
            CODE.replace("radius(perimeter) == r", "radius(perimeter) == random()"),
            format!("radius = 3mm\n{CODE}"),
            format!("sin = 3mm\n{CODE}"),
        ] {
            let program = Program::parse_no_errs(&code).unwrap();
            assert!(
                first_instance(&program, "profile").is_none(),
                "unexpectedly accepted {code}"
            );
        }
    }

    #[test]
    fn first_instance_accepts_trace_curved_profile() {
        let code = include_str!("../../tests/sketch_visualizer/curved_instance/input.kcl");
        let program = Program::parse_no_errs(code).unwrap();
        assert!(first_instance(&program, "curvedProfile").is_some());
        let shadowed = Program::parse_no_errs(&format!("sin = 3mm\n{code}")).unwrap();
        assert!(first_instance(&shadowed, "curvedProfile").is_none());
    }

    #[tokio::test]
    async fn first_instance_matches_trace_curved_profile() {
        let program =
            Program::parse_no_errs(include_str!("../../tests/sketch_visualizer/curved_instance/input.kcl")).unwrap();
        let isolated = first_instance(&program, "curvedProfile").unwrap();
        let full = execute(program).await;
        let selected = execute(isolated).await;
        assert_eq!(
            full.render_sketch_png_instance("curvedProfile", Some(0)).unwrap(),
            selected.render_sketch_png_instance("curvedProfile", Some(0)).unwrap()
        );
        let full_report = full.sketch_constraint_report();
        let selected_report = selected.sketch_constraint_report();
        let first = |report: crate::execution::SketchConstraintReport| {
            report
                .fully_constrained
                .into_iter()
                .chain(report.under_constrained)
                .chain(report.over_constrained)
                .find(|sketch| sketch.name == "curvedProfile" && sketch.instance_index == 0)
                .unwrap()
        };
        assert_eq!(first(full_report), first(selected_report));
        let plane = |outcome: crate::ExecOutcome| {
            let sketch = outcome
                .scene_objects
                .iter()
                .find(|s| s.label == "curvedProfile")
                .unwrap();
            let crate::front::ObjectKind::Sketch(sketch) = &sketch.kind else {
                panic!()
            };
            sketch.args.on.clone()
        };
        assert_eq!(plane(full), plane(selected));
    }

    #[tokio::test]
    async fn first_instance_matches_real_execution_png_and_constraints() {
        for plane in ["XY", "XZ", "YZ"] {
            let code = CODE
                .replace("profile = sketch(on = XY)", &format!("profile = sketch(on = {plane})"))
                .replace("r = 3mm, depth = depth", "r = -(depth - 8mm), depth = depth + 1mm")
                .replace(
                    "solid = extrude(region(segments = [profile.perimeter]), length = depth)",
                    "outline = region(segments = [profile.perimeter])\n  solid = extrude(outline, length = depth)",
                );
            let original = Program::parse_no_errs(&code).unwrap();
            let isolated = first_instance(&original, "profile").unwrap();
            let full = execute(original).await;
            let selected = execute(isolated).await;
            assert_eq!(
                full.render_sketch_png_instance("profile", Some(0)).unwrap(),
                selected.render_sketch_png_instance("profile", Some(0)).unwrap()
            );
            let full_report = full.sketch_constraint_report();
            let selected_report = selected.sketch_constraint_report();
            assert_eq!(
                full_report
                    .under_constrained
                    .iter()
                    .find(|s| s.name == "profile" && s.instance_index == 0)
                    .unwrap(),
                selected_report.under_constrained.first().unwrap()
            );
            let full_sketch = full.scene_objects.iter().find(|s| s.label == "profile").unwrap();
            let selected_sketch = selected.scene_objects.iter().find(|s| s.label == "profile").unwrap();
            let crate::front::ObjectKind::Sketch(full_sketch) = &full_sketch.kind else {
                panic!()
            };
            let crate::front::ObjectKind::Sketch(selected_sketch) = &selected_sketch.kind else {
                panic!()
            };
            assert_eq!(full_sketch.args.on, selected_sketch.args.on);
        }
    }
    async fn execute(program: Program) -> crate::ExecOutcome {
        let ctx = crate::ExecutorContext::new_with_client(Default::default(), None, None)
            .await
            .unwrap();
        let mut state = crate::ExecState::new(&ctx);
        let (env, _) = ctx.run(&program, &mut state).await.unwrap();
        let outcome = state.into_exec_outcome(env, &ctx).await.unwrap();
        ctx.close().await;
        outcome
    }
}
