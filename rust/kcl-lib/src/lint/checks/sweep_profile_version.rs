use anyhow::Result;

use crate::KclVersion;
use crate::execution::declared_kcl_version;
use crate::lint::rule::Discovered;
use crate::lint::rule::Finding;
use crate::lint::rule::FindingFamily;
use crate::lint::rule::def_finding;
use crate::parsing::ast::types::Expr;
use crate::parsing::ast::types::ImportSelector;
use crate::parsing::ast::types::LiteralValue;
use crate::parsing::ast::types::Node as AstNode;
use crate::parsing::ast::types::Program;
use crate::std::sweep::SWEEP_PROFILE_VERSION_ERROR;
use crate::walk::Node;

def_finding!(
    Z0008,
    SWEEP_PROFILE_VERSION_ERROR,
    SWEEP_PROFILE_VERSION_ERROR,
    FindingFamily::Correctness
);

pub fn lint_sweep_profile_version(node: Node, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Node::CallExpressionKw(call) = node else {
        return Ok(vec![]);
    };
    if call.callee.name.name != "sweep" {
        return Ok(vec![]);
    }
    // An unannotated imported file may inherit KCL3 from its entry point.
    if !declared_kcl_version(prog)?.is_some_and(|(version, _)| version <= KclVersion::V2) {
        return Ok(vec![]);
    }
    let bare = call.callee.local_ident().is_some();
    let standard_path = call
        .callee
        .path
        .iter()
        .map(|part| part.name.as_str())
        .eq(["std", "sketch"]);
    if !bare && !standard_path {
        return Ok(vec![]);
    }
    // Without name resolution, leave potentially shadowed calls to execution.
    if bare
        && !crate::walk::walk(prog, |node| {
            Ok::<_, anyhow::Error>(match node {
                Node::VariableDeclarator(var) => var.id.name != "sweep",
                Node::Parameter(param) => param.identifier.name != "sweep",
                Node::ImportStatement(import) => {
                    !matches!(import.selector, ImportSelector::Glob(_)) && !import.get_variable("sweep")
                }
                _ => true,
            })
        })?
    {
        return Ok(vec![]);
    }
    let arg = |label: &str| {
        call.arguments
            .iter()
            .find(|arg| arg.label.as_ref().is_some_and(|name| name.name == label))
    };
    if arg("translateProfileToPath").is_none() && arg("orientProfilePerpendicular").is_none() {
        return Ok(vec![]);
    }
    let invalid_version = match arg("version").map(|arg| &arg.arg) {
        None => true,
        Some(Expr::Literal(literal)) => matches!(literal.value, LiteralValue::Number { value, .. } if value != 2.0),
        // Computed versions are checked by the shared execution path.
        _ => false,
    };
    if !invalid_version {
        return Ok(vec![]);
    }
    Ok(vec![Z0008.at(
        SWEEP_PROFILE_VERSION_ERROR.to_owned(),
        call.as_source_range(),
        None,
    )])
}

#[cfg(test)]
mod tests {
    #[test]
    fn sweep_profile_version_lint_avoids_uncertain_and_valid_calls() {
        for code in [
            "@settings(kclVersion = 2.0)\nsweep(profile, path = route, orientProfilePerpendicular = false, version = 2)",
            "@settings(kclVersion = 2.0)\nsweep(profile, path = route, orientProfilePerpendicular = false, version = selected)",
            "@settings(kclVersion = 2.0)\nsweep(profile, path = route, orientProfilePerpendicular = false, version = 1 + 1)",
            "@settings(kclVersion = 2.0)\nsweep(profile, path = route, version = 1)",
            "@settings(kclVersion = \"3.0-preview\")\nsweep(profile, path = route, orientProfilePerpendicular = false)",
            "@settings(defaultLengthUnit = mm)\nsweep(profile, path = route, orientProfilePerpendicular = false)",
            "@settings(kclVersion = 2.0)\ncustom::sweep(profile, path = route, orientProfilePerpendicular = false)",
            "@settings(kclVersion = 2.0)\nfn sweep(@profile, path, orientProfilePerpendicular) { return 1 }\nsweep(profile, path = route, orientProfilePerpendicular = false)",
            "@settings(kclVersion = 2.0)\nfn run(sweep) { return sweep(profile, path = route, orientProfilePerpendicular = false) }",
            "@settings(kclVersion = 2.0)\nimport other as sweep from \"custom.kcl\"\nsweep(profile, path = route, orientProfilePerpendicular = false)",
            "@settings(kclVersion = 2.0)\nimport * from \"custom.kcl\"\nsweep(profile, path = route, orientProfilePerpendicular = false)",
        ] {
            let findings = crate::Program::parse_no_errs(code).unwrap().lint_all().unwrap();
            assert!(
                !findings.iter().any(|finding| finding.finding.code == "Z0008"),
                "{code}"
            );
        }
    }

    #[test]
    fn sweep_profile_version_lint_covers_qualified_calls_and_legacy_versions() {
        for version in ["1.0", "2.0"] {
            let code = format!(
                "@settings(kclVersion = {version})\nstd::sketch::sweep(profile, path = route, orientProfilePerpendicular = false)"
            );
            let findings = crate::Program::parse_no_errs(&code).unwrap().lint_all().unwrap();
            assert_eq!(
                findings
                    .iter()
                    .filter(|finding| finding.finding.code == "Z0008")
                    .count(),
                1
            );
        }
    }
}
