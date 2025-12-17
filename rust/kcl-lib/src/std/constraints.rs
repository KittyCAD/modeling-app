use anyhow::Result;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue},
    std::Args,
};

pub async fn parallel(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    Err(KclError::Internal {
        details: KclErrorDetails::new("Not yet implemented".to_owned(), vec![args.source_range]),
    })
}
