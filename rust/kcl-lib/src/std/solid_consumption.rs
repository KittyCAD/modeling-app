use itertools::Itertools;

use crate::CompilationIssue;
use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::errors::Tag;
use crate::execution::ConsumedSolidInfo;
use crate::execution::ConsumedSolidKey;
use crate::execution::ConsumedSolidOperation;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::Solid;
use crate::execution::annotations;

pub(crate) fn validate_value_not_consumed(
    value: &KclValue,
    exec_state: &ExecState,
    source_range: SourceRange,
) -> Result<(), KclError> {
    if let Some(message) = consumed_value_error_message(value, exec_state)? {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            message,
            vec![source_range],
        )));
    }

    Ok(())
}

pub(crate) fn warn_if_value_consumed_for_deprecated_call(
    value: &KclValue,
    exec_state: &mut ExecState,
    source_range: SourceRange,
    std_fn_name: &str,
) -> Result<(), KclError> {
    let Some(consumed_message) = consumed_value_error_message(value, exec_state)? else {
        return Ok(());
    };

    let function_name = std_fn_name.rsplit("::").next().unwrap_or(std_fn_name);
    let mut issue = CompilationIssue::err(
        source_range,
        format!(
            "Calling `{function_name}` with a consumed solid is deprecated and will become an error in the next KCL version. {consumed_message}"
        ),
    );
    issue.tag = Tag::Deprecated;
    exec_state.warn(issue, annotations::WARN_DEPRECATED);
    Ok(())
}

fn consumed_value_error_message(value: &KclValue, exec_state: &ExecState) -> Result<Option<String>, KclError> {
    match value {
        KclValue::Solid { value } => consumed_solid_error_message(value, exec_state),
        KclValue::HomArray { value, .. } | KclValue::Tuple { value, .. } => {
            for value in value {
                if let Some(message) = consumed_value_error_message(value, exec_state)? {
                    return Ok(Some(message));
                }
            }
            Ok(None)
        }
        KclValue::Object { value, .. } => {
            for (_, value) in value.iter().sorted_by(|(left, _), (right, _)| left.cmp(right)) {
                if let Some(message) = consumed_value_error_message(value, exec_state)? {
                    return Ok(Some(message));
                }
            }
            Ok(None)
        }
        _ => Ok(None),
    }
}

pub(super) fn validate_solids_not_consumed(
    solids: &[Solid],
    exec_state: &ExecState,
    source_range: SourceRange,
) -> Result<(), KclError> {
    solids
        .iter()
        .try_for_each(|solid| validate_solid_not_consumed(solid, exec_state, source_range))
}

fn validate_solid_not_consumed(
    solid: &Solid,
    exec_state: &ExecState,
    source_range: SourceRange,
) -> Result<(), KclError> {
    if let Some(message) = consumed_solid_error_message(solid, exec_state)? {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            message,
            vec![source_range],
        )));
    }

    Ok(())
}

fn consumed_solid_error_message(solid: &Solid, exec_state: &ExecState) -> Result<Option<String>, KclError> {
    let key = consumed_solid_key(solid);
    let Some(info) = exec_state.check_solid_consumed(&key) else {
        if let Some(info) = exec_state.check_solid_id_consumed(&solid.id)
            && info.should_report_reused_engine_id_as_consumed(key)
        {
            let operation = info.operation();
            let current_var = exec_state.find_var_name_for_solid_key(key)?;
            let output_var = exec_state
                .latest_consumed_output(info.suggested_replacement_key())
                .map(|key| exec_state.find_var_name_for_solid_key(key))
                .transpose()?
                .flatten();
            let message = build_stale_body_error_message(current_var.as_deref(), operation, output_var.as_deref());

            return Ok(Some(message));
        }

        return Ok(None);
    };
    let operation = info.operation();
    let suggested_replacement_key = info.suggested_replacement_key();
    let consumed_var = exec_state.find_var_name_for_solid_key(key)?;
    let output_var = exec_state
        .latest_consumed_output(suggested_replacement_key)
        .map(|key| exec_state.find_var_name_for_solid_key(key))
        .transpose()?
        .flatten();
    let message = build_consumed_error_message(consumed_var.as_deref(), operation, output_var.as_deref());

    Ok(Some(message))
}

pub(super) fn record_consumed_solids(
    exec_state: &mut ExecState,
    solids: &[Solid],
    operation: ConsumedSolidOperation,
    output_solids: &[Solid],
) {
    let returned_solid_keys = output_solids.iter().map(consumed_solid_key).collect::<Vec<_>>();
    for solid in solids {
        let info = ConsumedSolidInfo::new(operation, returned_solid_keys.clone());
        exec_state.mark_solid_consumed(consumed_solid_key(solid), info.clone());
        exec_state.mark_solid_id_consumed(solid.id, info);
    }
}

pub(super) fn is_consuming_operation_output(solid: &Solid, exec_state: &ExecState) -> bool {
    exec_state.is_consuming_operation_output(&consumed_solid_key(solid))
}

fn consumed_solid_key(solid: &Solid) -> ConsumedSolidKey {
    ConsumedSolidKey::new(solid.id, solid.value_id)
}

fn build_consumed_error_message(
    consumed_var: Option<&str>,
    operation: ConsumedSolidOperation,
    output_var: Option<&str>,
) -> String {
    let article = operation.indefinite_article();

    match (consumed_var, output_var) {
        (Some(consumed), Some(output)) => format!(
            "`{consumed}` was already consumed by {article} `{operation}` operation. \
             The operation result is now in `{output}`; use that for subsequent operations."
        ),
        (Some(consumed), None) => format!(
            "`{consumed}` was already consumed by {article} `{operation}` operation \
             and can no longer be used. Some operations destroy their inputs; \
             assign the result to a variable and use it for subsequent operations."
        ),
        (None, Some(output)) => format!(
            "A solid was already consumed by {article} `{operation}` operation. \
             The operation result is now in `{output}`; use that for subsequent operations."
        ),
        (None, None) => format!(
            "A solid was already consumed by {article} `{operation}` operation \
             and can no longer be used. Some operations destroy their inputs; \
             assign the result to a variable and use it for subsequent operations."
        ),
    }
}

fn build_stale_body_error_message(
    current_var: Option<&str>,
    operation: ConsumedSolidOperation,
    output_var: Option<&str>,
) -> String {
    let article = operation.indefinite_article();

    match (current_var, output_var) {
        (Some(current), Some(output)) => format!(
            "`{current}` refers to a solid body that was already consumed by {article} `{operation}` operation. \
             The operation result is now in `{output}`; use that for subsequent operations."
        ),
        (Some(current), None) => format!(
            "`{current}` refers to a solid body that was already consumed by {article} `{operation}` operation \
             and can no longer be used."
        ),
        (None, Some(output)) => format!(
            "A solid body was already consumed by {article} `{operation}` operation. \
             The operation result is now in `{output}`; use that for subsequent operations."
        ),
        (None, None) => {
            format!("A solid body was already consumed by {article} `{operation}` operation and can no longer be used.")
        }
    }
}

#[cfg(test)]
mod tests {
    use kcl_api::UnitLength;
    use uuid::Uuid;

    use super::*;
    use crate::MockConfig;
    use crate::execution::ArtifactId;
    use crate::execution::KclValue;
    use crate::execution::MemoryBackendKind;
    use crate::execution::SolidCreator;

    fn procedural_solid(id: Uuid, value_id: Uuid) -> Solid {
        Solid {
            id,
            value_id,
            artifact_id: ArtifactId::new(id),
            value: vec![],
            faces: Default::default(),
            creator: SolidCreator::Procedural,
            start_cap_id: None,
            end_cap_id: None,
            edge_cuts: vec![],
            pending_edge_cut_ids: vec![],
            units: UnitLength::Millimeters,
            sectional: false,
            meta: vec![SourceRange::default().into()],
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn consumed_solid_diagnostic_names_match_between_memory_backends() {
        for &backend in MemoryBackendKind::all() {
            let ctx = crate::ExecutorContext::new_mock(None).await;
            let mut exec_state = ExecState::new_mock_with_memory_backend(&ctx, &MockConfig::default(), backend);
            let target = procedural_solid(Uuid::from_u128(1), Uuid::from_u128(2));

            exec_state
                .mut_stack()
                .push_new_root_env(false)
                .expect("test root environment should be created");
            exec_state
                .mut_stack()
                .add(
                    "target".to_owned(),
                    KclValue::Solid {
                        value: Box::new(target.clone()),
                    },
                    SourceRange::default(),
                )
                .unwrap();
            record_consumed_solids(
                &mut exec_state,
                std::slice::from_ref(&target),
                ConsumedSolidOperation::Subtract,
                &[],
            );

            let err = validate_solids_not_consumed(std::slice::from_ref(&target), &exec_state, SourceRange::default())
                .expect_err("consumed target should be rejected");
            assert!(
                err.message()
                    .contains("`target` was already consumed by a `subtract` operation"),
                "{backend:?}: {err:?}",
            );

            ctx.close().await;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn replacement_solid_reusing_consumed_engine_id_remains_usable() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let engine_id = Uuid::from_u128(1);
        let consumed = procedural_solid(engine_id, Uuid::from_u128(2));
        let output = procedural_solid(engine_id, Uuid::from_u128(3));

        // Boolean operations may return a replacement KCL solid that reuses an
        // engine body id from one of the consumed inputs.
        record_consumed_solids(
            &mut exec_state,
            std::slice::from_ref(&consumed),
            ConsumedSolidOperation::Subtract,
            std::slice::from_ref(&output),
        );

        validate_solids_not_consumed(std::slice::from_ref(&output), &exec_state, SourceRange::default())
            .expect("replacement output should remain usable");
        assert!(is_consuming_operation_output(&output, &exec_state));
        assert!(!is_consuming_operation_output(&consumed, &exec_state));
        assert!(
            validate_solids_not_consumed(std::slice::from_ref(&consumed), &exec_state, SourceRange::default()).is_err()
        );

        ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn stale_engine_id_on_distinct_value_is_rejected() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let consumed = procedural_solid(Uuid::from_u128(1), Uuid::from_u128(2));
        let output = procedural_solid(Uuid::from_u128(3), Uuid::from_u128(3));
        let stale_alias = procedural_solid(consumed.id, Uuid::from_u128(4));

        record_consumed_solids(
            &mut exec_state,
            std::slice::from_ref(&consumed),
            ConsumedSolidOperation::Subtract,
            std::slice::from_ref(&output),
        );

        let err = validate_solids_not_consumed(std::slice::from_ref(&stale_alias), &exec_state, SourceRange::default())
            .expect_err("stale engine body id should be rejected before the engine sees it");
        assert!(
            err.message()
                .contains("A solid body was already consumed by a `subtract` operation"),
            "{err:?}"
        );

        ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn extra_replacement_solid_reusing_consumed_engine_id_remains_usable() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let consumed = procedural_solid(Uuid::from_u128(1), Uuid::from_u128(2));
        let primary_output = procedural_solid(Uuid::from_u128(3), Uuid::from_u128(3));
        let extra_output = procedural_solid(consumed.id, Uuid::from_u128(3));

        record_consumed_solids(
            &mut exec_state,
            std::slice::from_ref(&consumed),
            ConsumedSolidOperation::Subtract,
            &[primary_output, extra_output.clone()],
        );

        validate_solids_not_consumed(std::slice::from_ref(&extra_output), &exec_state, SourceRange::default())
            .expect("any replacement output should remain usable");

        ctx.close().await;
    }
}
