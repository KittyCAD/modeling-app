use uuid::Uuid;

use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ConsumedSolidInfo;
use crate::execution::ConsumedSolidOperation;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::Solid;

pub(crate) fn validate_value_not_consumed(
    value: &KclValue,
    exec_state: &ExecState,
    source_range: SourceRange,
) -> Result<(), KclError> {
    match value {
        KclValue::Solid { value } => validate_solid_not_consumed(value, exec_state, source_range),
        KclValue::HomArray { value, .. } | KclValue::Tuple { value, .. } => value
            .iter()
            .try_for_each(|v| validate_value_not_consumed(v, exec_state, source_range)),
        KclValue::Object { value, .. } => value
            .values()
            .try_for_each(|v| validate_value_not_consumed(v, exec_state, source_range)),
        _ => Ok(()),
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
    let Some(info) = exec_state.check_solid_consumed(&solid.id) else {
        return Ok(());
    };
    let operation = info.operation;
    let output_solid_id = info.output_solid_id;
    let consumed_var = exec_state.find_var_name_for_solid_id(solid.id);
    let output_var = exec_state
        .latest_consumed_output(output_solid_id)
        .and_then(|id| exec_state.find_var_name_for_solid_id(id));
    let message = build_consumed_error_message(consumed_var.as_deref(), operation, output_var.as_deref());

    Err(KclError::new_semantic(KclErrorDetails::new(
        message,
        vec![source_range],
    )))
}

pub(super) fn record_consumed_solids(
    exec_state: &mut ExecState,
    solids: &[Solid],
    operation: ConsumedSolidOperation,
    output_solid_id: Option<Uuid>,
) {
    for solid in solids {
        exec_state.mark_solid_consumed(
            solid.id,
            ConsumedSolidInfo {
                operation,
                output_solid_id,
            },
        );
    }
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
