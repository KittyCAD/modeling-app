use uuid::Uuid;

use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ConsumedSolidInfo;
use crate::execution::ConsumedSolidOperation;
use crate::execution::ExecState;
use crate::execution::Solid;

pub(super) fn validate_solids_not_consumed(
    solids: &[Solid],
    exec_state: &ExecState,
    source_range: SourceRange,
) -> Result<(), KclError> {
    for solid in solids {
        let Some(info) = exec_state.check_solid_consumed(&solid.id) else {
            continue;
        };
        let operation = info.operation;
        let output_solid_id = info.output_solid_id;
        let consumed_var = exec_state.find_var_name_for_solid_id(solid.id);
        let output_var = exec_state
            .latest_consumed_output(output_solid_id)
            .and_then(|id| exec_state.find_var_name_for_solid_id(id));
        let message = build_consumed_error_message(consumed_var.as_deref(), operation, output_var.as_deref());

        return Err(KclError::new_semantic(KclErrorDetails::new(
            message,
            vec![source_range],
        )));
    }

    Ok(())
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
