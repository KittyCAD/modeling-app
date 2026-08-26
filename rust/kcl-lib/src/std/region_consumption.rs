use itertools::Itertools;
use uuid::Uuid;

use crate::CompilationIssue;
use crate::SourceRange;
use crate::collections::AhashIndexSet;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ConsumedRegionInfo;
use crate::execution::ConsumedRegionOperation;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::Sketch;
use crate::execution::annotations;
use crate::std::Args;
use crate::std::ConsumedRegionAliasPolicy;
use crate::std::ConsumedRegionDuplicatePolicy;
use crate::std::RegionBehavior;

const REGION_REUSE_WORKAROUND: &str = "Create a separate region for each consuming operation by calling `region(...)` multiple times with the original sketch. Do not clone the source sketch.";

#[derive(Debug)]
pub(crate) struct PendingRegionConsumption {
    region_ids: AhashIndexSet<Uuid>,
    operation: ConsumedRegionOperation,
}

struct ConsumedRegionReference {
    subject: String,
    operation: ConsumedRegionOperation,
}

/// Validate same-call Region ownership and retain the Regions that should be
/// marked consumed only if the stdlib call succeeds.
pub(crate) fn prepare_region_consumption(
    behavior: RegionBehavior,
    args: &Args,
    exec_state: &ExecState,
) -> Result<Option<PendingRegionConsumption>, KclError> {
    let RegionBehavior::Consume(policy) = behavior else {
        return Ok(None);
    };
    let Some(input) = args.unlabeled_kw_arg_unconverted() else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "A region-consuming stdlib function has no input argument".to_owned(),
            vec![args.source_range],
        )));
    };

    let mut input_region_ids = Vec::new();
    collect_region_ids(&input.value, &mut input_region_ids);
    let mut region_ids = AhashIndexSet::default();
    for region_id in input_region_ids {
        if !region_ids.insert(region_id) && policy.duplicate_policy == ConsumedRegionDuplicatePolicy::Reject {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                duplicate_region_message(region_id, policy.operation, exec_state)?,
                vec![input.source_range],
            )));
        }
    }

    match policy.alias_policy {
        ConsumedRegionAliasPolicy::None => {}
        ConsumedRegionAliasPolicy::Reject(arg_name) => {
            let Some(alias_arg) = args.labeled.get(arg_name) else {
                return Ok(pending_if_not_empty(region_ids, policy.operation));
            };
            let mut alias_region_ids = Vec::new();
            collect_region_ids(&alias_arg.value, &mut alias_region_ids);
            let alias_region_ids = alias_region_ids.into_iter().collect::<AhashIndexSet<_>>();
            if let Some(region_id) = region_ids.iter().find(|id| alias_region_ids.contains(*id)).copied() {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    rejected_alias_message(region_id, policy.operation, arg_name, exec_state)?,
                    vec![alias_arg.source_range],
                )));
            }
        }
        ConsumedRegionAliasPolicy::Preserve(arg_name) => {
            let Some(alias_arg) = args.labeled.get(arg_name) else {
                return Ok(pending_if_not_empty(region_ids, policy.operation));
            };
            let mut alias_region_ids = Vec::new();
            collect_region_ids(&alias_arg.value, &mut alias_region_ids);
            let alias_region_ids = alias_region_ids.into_iter().collect::<AhashIndexSet<_>>();
            region_ids.retain(|region_id| !alias_region_ids.contains(region_id));
        }
    }

    Ok(pending_if_not_empty(region_ids, policy.operation))
}

pub(crate) fn record_consumed_regions(exec_state: &mut ExecState, pending: PendingRegionConsumption) {
    let info = ConsumedRegionInfo::new(pending.operation);
    for region_id in pending.region_ids {
        exec_state.mark_region_consumed(region_id, info);
    }
}

pub(crate) fn validate_region_args_not_consumed(args: &Args, exec_state: &ExecState) -> Result<(), KclError> {
    let Some((consumed, source_range)) = first_consumed_region_arg(args, exec_state)? else {
        return Ok(());
    };

    Err(KclError::new_semantic(KclErrorDetails::new(
        format!(
            "{} was already consumed by a `{}` operation and can no longer be used. {REGION_REUSE_WORKAROUND}",
            consumed.subject, consumed.operation
        ),
        vec![source_range],
    )))
}

pub(crate) fn warn_if_region_args_consumed(
    args: &Args,
    exec_state: &mut ExecState,
    std_fn_name: &str,
) -> Result<(), KclError> {
    let Some((consumed, source_range)) = first_consumed_region_arg(args, exec_state)? else {
        return Ok(());
    };

    let function_name = std_fn_name.rsplit("::").next().unwrap_or(std_fn_name);
    exec_state.warn(
        CompilationIssue::err(
            source_range,
            format!(
                "{} was already consumed by `{}`. Passing it to `{function_name}` may fail or have no effect because its engine object may no longer be valid. {REGION_REUSE_WORKAROUND}",
                consumed.subject, consumed.operation
            ),
        ),
        annotations::WARN_REGION_LIVENESS,
    );

    Ok(())
}

fn first_consumed_region_arg(
    args: &Args,
    exec_state: &ExecState,
) -> Result<Option<(ConsumedRegionReference, SourceRange)>, KclError> {
    if let Some((_, input)) = args.unlabeled.first()
        && let Some(consumed) = first_consumed_region_reference(&input.value, exec_state)?
    {
        return Ok(Some((consumed, input.source_range)));
    }

    for arg in args.labeled.values() {
        if let Some(consumed) = first_consumed_region_reference(&arg.value, exec_state)? {
            return Ok(Some((consumed, arg.source_range)));
        }
    }

    Ok(None)
}

fn first_consumed_region_reference(
    value: &KclValue,
    exec_state: &ExecState,
) -> Result<Option<ConsumedRegionReference>, KclError> {
    match value {
        KclValue::Sketch { value } => consumed_region_reference(value, exec_state),
        KclValue::HomArray { value, .. } | KclValue::Tuple { value, .. } => {
            for value in value {
                if let Some(consumed) = first_consumed_region_reference(value, exec_state)? {
                    return Ok(Some(consumed));
                }
            }
            Ok(None)
        }
        KclValue::Object { value, .. } => {
            for (_, value) in value.iter().sorted_by(|(left, _), (right, _)| left.cmp(right)) {
                if let Some(consumed) = first_consumed_region_reference(value, exec_state)? {
                    return Ok(Some(consumed));
                }
            }
            Ok(None)
        }
        _ => Ok(None),
    }
}

fn consumed_region_reference(
    region: &Sketch,
    exec_state: &ExecState,
) -> Result<Option<ConsumedRegionReference>, KclError> {
    if region.origin_sketch_id.is_none() {
        return Ok(None);
    }
    let Some(info) = exec_state.check_region_consumed(&region.id) else {
        return Ok(None);
    };
    let subject = region_subject(region.id, exec_state)?;

    Ok(Some(ConsumedRegionReference {
        subject,
        operation: info.operation(),
    }))
}

fn collect_region_ids(value: &KclValue, region_ids: &mut Vec<Uuid>) {
    match value {
        KclValue::Sketch { value } if value.origin_sketch_id.is_some() => region_ids.push(value.id),
        KclValue::HomArray { value, .. } | KclValue::Tuple { value, .. } => {
            for value in value {
                collect_region_ids(value, region_ids);
            }
        }
        KclValue::Object { value, .. } => {
            for (_, value) in value.iter().sorted_by(|(left, _), (right, _)| left.cmp(right)) {
                collect_region_ids(value, region_ids);
            }
        }
        _ => {}
    }
}

fn pending_if_not_empty(
    region_ids: AhashIndexSet<Uuid>,
    operation: ConsumedRegionOperation,
) -> Option<PendingRegionConsumption> {
    (!region_ids.is_empty()).then_some(PendingRegionConsumption { region_ids, operation })
}

fn duplicate_region_message(
    region_id: Uuid,
    operation: ConsumedRegionOperation,
    exec_state: &ExecState,
) -> Result<String, KclError> {
    let subject = region_subject(region_id, exec_state)?;
    Ok(format!(
        "{subject} is used more than once as a profile in the same `{operation}` call. `{operation}` consumes region profiles, so each profile can be used only once. {REGION_REUSE_WORKAROUND}"
    ))
}

fn rejected_alias_message(
    region_id: Uuid,
    operation: ConsumedRegionOperation,
    arg_name: &str,
    exec_state: &ExecState,
) -> Result<String, KclError> {
    let subject = region_subject(region_id, exec_state)?;
    Ok(format!(
        "{subject} is used as both the profile and the `{arg_name}` argument in the same `{operation}` call. `{operation}` consumes region profiles, so the same profile cannot also be used as its `{arg_name}` argument. {REGION_REUSE_WORKAROUND}"
    ))
}

fn region_subject(region_id: Uuid, exec_state: &ExecState) -> Result<String, KclError> {
    Ok(match exec_state.find_var_name_for_region_id(region_id)? {
        Some(var_name) => format!("`{var_name}`"),
        None => "A region".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MockConfig;
    use crate::Program;

    const REGION_SETUP: &str = r#"@settings(defaultLengthUnit = mm, kclVersion = 2.0, experimentalFeatures = allow)

profileSketch = sketch(on = XY) {
  c = circle(start = [var 25mm, var 0mm], center = [var 20mm, var 0mm])
}
sharedRegion = region(segments = [profileSketch.c])
"#;

    const PATH_SETUP: &str = r#"
pathSketch = sketch(on = XZ) {
  path = line(start = [var 0mm, var 0mm], end = [var 0mm, var 100mm])
}
"#;

    async fn run_mock(code: &str) -> Result<crate::ExecOutcome, crate::KclErrorWithOutputs> {
        let program = Program::parse_no_errs(code).unwrap();
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let result = ctx.run_mock(&program, &MockConfig::default()).await;
        ctx.close().await;
        result
    }

    async fn assert_mock_success(code: &str) {
        let outcome = run_mock(code)
            .await
            .unwrap_or_else(|error| panic!("mock execution failed: {}", error.error.message()));
        assert!(
            outcome
                .issues
                .iter()
                .all(|issue| !issue.message.contains(REGION_REUSE_WORKAROUND)),
            "unexpected region-liveness issue: {:#?}",
            outcome.issues
        );
    }

    async fn assert_mock_warning(code: &str, expected_message: &str, expected_range_text: &str) {
        let outcome = run_mock(code)
            .await
            .unwrap_or_else(|error| panic!("mock execution failed: {}", error.error.message()));
        assert_eq!(outcome.issues.len(), 1, "expected one issue: {:#?}", outcome.issues);
        assert_eq!(outcome.issues[0].severity, crate::errors::Severity::Warning);
        assert_eq!(outcome.issues[0].message, expected_message);

        let start = code
            .rfind(expected_range_text)
            .unwrap_or_else(|| panic!("expected `{expected_range_text}` in test KCL"));
        assert_eq!(
            outcome.issues[0].source_range,
            crate::SourceRange::from([start, start + expected_range_text.len(), 0])
        );
    }

    async fn assert_mock_error(code: &str, expected_message: &str, expected_range_text: &str, expected_call: &str) {
        let error = run_mock(code)
            .await
            .expect_err("mock execution should reject stale Region use");
        assert!(matches!(&error.error, KclError::Semantic { .. }), "{:?}", error.error);
        assert_eq!(error.error.message(), expected_message);

        let start = code
            .rfind(expected_range_text)
            .unwrap_or_else(|| panic!("expected `{expected_range_text}` in test KCL"));
        let call_start = code[..start]
            .rfind(&format!("{expected_call}("))
            .unwrap_or_else(|| panic!("expected `{expected_call}(` before the diagnostic range"));
        let call_end = code[call_start..]
            .find('\n')
            .map_or(code.len(), |line_end| call_start + line_end);
        assert_eq!(
            error.error.source_ranges(),
            vec![
                crate::SourceRange::from([start, start + expected_range_text.len(), 0]),
                crate::SourceRange::from([call_start, call_end, 0]),
            ]
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn reused_sweep_region_reports_the_workaround_at_the_second_use() {
        let code = format!(
            "{REGION_SETUP}{PATH_SETUP}\
first = sweep(sharedRegion, path = [pathSketch.path], version = 2)\n\
second = sweep(sharedRegion, path = [pathSketch.path], version = 2)\n"
        );

        assert_mock_error(
            &code,
            "`sharedRegion` was already consumed by a `sweep` operation and can no longer be used. Create a separate region for each consuming operation by calling `region(...)` multiple times with the original sketch. Do not clone the source sketch.",
            "sharedRegion",
            "sweep",
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn extrude_region_cannot_also_be_its_to_reference() {
        let code = format!("{REGION_SETUP}extrude(sharedRegion, to = sharedRegion)\n");

        assert_mock_error(
            &code,
            "`sharedRegion` is used as both the profile and the `to` argument in the same `extrude` call. `extrude` consumes region profiles, so the same profile cannot also be used as its `to` argument. Create a separate region for each consuming operation by calling `region(...)` multiple times with the original sketch. Do not clone the source sketch.",
            "sharedRegion",
            "extrude",
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn every_consuming_operation_records_its_region() {
        let cases = [
            (
                "extrude",
                format!(
                    "{REGION_SETUP}first = extrude(sharedRegion, length = 10mm)\nsecond = extrude(sharedRegion, length = 20mm)\n"
                ),
            ),
            (
                "revolve",
                format!(
                    "{REGION_SETUP}first = revolve(sharedRegion, axis = Y, angle = 180deg)\nsecond = extrude(sharedRegion, length = 20mm)\n"
                ),
            ),
            (
                "sweep",
                format!(
                    "{REGION_SETUP}{PATH_SETUP}first = sweep(sharedRegion, path = [pathSketch.path], version = 2)\nsecond = extrude(sharedRegion, length = 20mm)\n"
                ),
            ),
            (
                "delete",
                format!(
                    "{REGION_SETUP}delete([sharedRegion, sharedRegion])\nsecond = extrude(sharedRegion, length = 20mm)\n"
                ),
            ),
        ];

        for (operation, code) in cases {
            assert_mock_error(
                &code,
                &format!(
                    "`sharedRegion` was already consumed by a `{operation}` operation and can no longer be used. {REGION_REUSE_WORKAROUND}"
                ),
                "sharedRegion",
                "extrude",
            )
            .await;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn consumed_regions_warn_for_non_profile_engine_uses() {
        let cases = [
            (
                "extrude",
                "hide",
                format!("{REGION_SETUP}first = extrude(sharedRegion, length = 10mm)\nhide(sharedRegion)\n"),
            ),
            (
                "revolve",
                "hide",
                format!("{REGION_SETUP}first = revolve(sharedRegion, axis = Y, angle = 180deg)\nhide(sharedRegion)\n"),
            ),
            (
                "sweep",
                "hide",
                format!(
                    "{REGION_SETUP}{PATH_SETUP}first = sweep(sharedRegion, path = [pathSketch.path], version = 2)\nhide(sharedRegion)\n"
                ),
            ),
            (
                "delete",
                "hide",
                format!("{REGION_SETUP}delete(sharedRegion)\nhide(sharedRegion)\n"),
            ),
            (
                "extrude",
                "delete",
                format!("{REGION_SETUP}first = extrude(sharedRegion, length = 10mm)\ndelete(sharedRegion)\n"),
            ),
        ];

        for (consumer, current_function, code) in cases {
            assert_mock_warning(
                &code,
                &format!(
                    "`sharedRegion` was already consumed by `{consumer}`. Passing it to `{current_function}` may fail or have no effect because its engine object may no longer be valid. {REGION_REUSE_WORKAROUND}"
                ),
                "sharedRegion",
            )
            .await;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn duplicate_consuming_profiles_are_rejected_before_engine_execution() {
        let cases = [
            (
                "extrude",
                format!("{REGION_SETUP}extrude([sharedRegion, sharedRegion], length = 10mm)\n"),
            ),
            (
                "revolve",
                format!("{REGION_SETUP}revolve([sharedRegion, sharedRegion], axis = Y, angle = 180deg)\n"),
            ),
            (
                "sweep",
                format!(
                    "{REGION_SETUP}{PATH_SETUP}sweep([sharedRegion, sharedRegion], path = [pathSketch.path], version = 2)\n"
                ),
            ),
        ];

        for (operation, code) in cases {
            let error = run_mock(&code)
                .await
                .expect_err("duplicate consuming profiles should be rejected");
            assert_eq!(
                error.error.message(),
                format!(
                    "`sharedRegion` is used more than once as a profile in the same `{operation}` call. `{operation}` consumes region profiles, so each profile can be used only once. {REGION_REUSE_WORKAROUND}"
                )
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn same_region_sweep_profile_and_path_remains_live() {
        let code = format!(
            "{REGION_SETUP}\
first = sweep(sharedRegion, path = sharedRegion, version = 2)\n\
after = hide(sharedRegion)\n"
        );

        assert_mock_success(&code).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn consumed_regions_remain_available_to_every_local_reader() {
        let code = format!(
            "{REGION_SETUP}\
fn readStart(@profile: Sketch): Point2d {{
  return profileStart(profile)
}}
first = extrude(sharedRegion, length = 10mm)

start = readStart(sharedRegion)
startX = profileStartX(sharedRegion)
startY = profileStartY(sharedRegion)
endX = lastSegX(sharedRegion)
endY = lastSegY(sharedRegion)

mapped = map([sharedRegion], f = fn(@item) {{ return profileStart(item) }})
reduced = reduce([sharedRegion], initial = sharedRegion, f = fn(@item, accum) {{ return accum }})
pushed = push([sharedRegion], item = sharedRegion)
popped = pop([sharedRegion])
concatenated = concat([sharedRegion], items = [sharedRegion])
sliced = slice([sharedRegion], start = 0)
flattened = flatten([[sharedRegion]])
regionCount = count([sharedRegion])

newRectangle = rectangle(sharedRegion, width = 4mm, height = 2mm, center = [35mm, 0mm])
newCircle = circle(sharedRegion, center = [40mm, 0mm], radius = 2mm)
newEllipse = ellipse(sharedRegion, center = [45mm, 0mm], majorRadius = 3mm, minorRadius = 2mm)
newThreePointCircle = circleThreePoint(sharedRegion, p1 = [50mm, 0mm], p2 = [52mm, 2mm], p3 = [54mm, 0mm])
newPolygon = polygon(sharedRegion, radius = 2mm, numSides = 5, center = [60mm, 0mm])
"
        );

        assert_mock_success(&code).await;
    }

    #[test]
    fn every_local_region_reader_is_registered() {
        let readers = [
            ("array", "map"),
            ("array", "reduce"),
            ("array", "push"),
            ("array", "pop"),
            ("array", "concat"),
            ("array", "slice"),
            ("array", "flatten"),
            ("sketch", "rectangle"),
            ("sketch", "circle"),
            ("sketch", "ellipse"),
            ("sketch", "circleThreePoint"),
            ("sketch", "polygon"),
            ("sketch", "lastSegX"),
            ("sketch", "lastSegY"),
            ("sketch", "profileStart"),
            ("sketch", "profileStartX"),
            ("sketch", "profileStartY"),
        ];

        for (module, function) in readers {
            let (_, props) = crate::std::std_fn(module, function);
            assert_eq!(
                props.region_behavior,
                RegionBehavior::ReadLocal,
                "`std::{module}::{function}` must use the local region-read behavior"
            );
        }
    }

    #[test]
    fn consuming_operations_register_their_stale_region_policy() {
        let cases = [
            ("sketch", "extrude", ConsumedRegionOperation::Extrude),
            ("sketch", "revolve", ConsumedRegionOperation::Revolve),
            ("sketch", "sweep", ConsumedRegionOperation::Sweep),
            ("transform", "delete", ConsumedRegionOperation::Delete),
        ];

        for (module, function, expected_operation) in cases {
            let (_, props) = crate::std::std_fn(module, function);
            let RegionBehavior::Consume(policy) = props.region_behavior else {
                panic!("`std::{module}::{function}` must register region consumption");
            };
            assert_eq!(policy.operation, expected_operation);
            assert_eq!(
                policy.stale_region_policy,
                if expected_operation == ConsumedRegionOperation::Delete {
                    crate::std::StaleRegionPolicy::Warning
                } else {
                    crate::std::StaleRegionPolicy::Error
                },
                "unexpected stale-region policy for `std::{module}::{function}`"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn multiple_regions_from_the_original_sketch_are_independently_consumable() {
        let code = r#"@settings(defaultLengthUnit = mm, kclVersion = 2.0)

profileSketch = sketch(on = XY) {
  c = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
}
firstRegion = region(segments = [profileSketch.c])
secondRegion = region(segments = [profileSketch.c])

first = extrude(firstRegion, length = 10mm)
second = extrude(secondRegion, length = 20mm)
"#;

        assert_mock_success(code).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn sketch_block_results_are_not_tracked_as_regions() {
        let code = r#"@settings(defaultLengthUnit = mm, kclVersion = 2.0)

profileSketch = sketch(on = XY) {
  c = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
}

first = extrude(profileSketch, length = 10mm, bodyType = SURFACE)
second = extrude(profileSketch, length = 20mm, bodyType = SURFACE)
"#;

        assert_mock_success(code).await;
    }
}
