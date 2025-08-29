use crate::errors::KclErrorDetails;
use crate::std::Args;
use crate::{ExecState, KclError};
use crate::exec::KclValue;
use crate::execution::types::RuntimeType;

use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;

pub async fn label(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let item: KclValue = args.get_unlabeled_kw_arg("item", &RuntimeType::any(), exec_state)?;
    let text: String = args.get_kw_arg("text", &RuntimeType::string(), exec_state)?;
    if let Some(id) = item.id() {
        let command = ModelingCmd::from(mcmd::SetLabel {
            object_id: id,
            label: text,
        });
        let _ = exec_state.send_modeling_cmd((&args).into(), command).await?;
        Ok(KclValue::none())
    } else {
        Err(KclError::Type {
            details: KclErrorDetails::new(
                format!("This type is not suitable for labeling"),
                vec![args.source_range.into()],
            )
        })
    }
}