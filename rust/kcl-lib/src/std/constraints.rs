use anyhow::Result;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{AbstractSegment, ExecState, KclValue, SegmentRepr, UnsolvedSegment, types::RuntimeType},
    std::Args,
};

pub async fn line(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let start: Vec<KclValue> = args.get_kw_arg("start", &RuntimeType::point2d(), exec_state)?;
    // TODO: make this optional and add midpoint.
    let end: Vec<KclValue> = args.get_kw_arg("end", &RuntimeType::point2d(), exec_state)?;
    if start.len() != 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start must be a 2D point".to_owned(),
            vec![args.source_range],
        )));
    }
    if end.len() != 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end must be a 2D point".to_owned(),
            vec![args.source_range],
        )));
    }
    // SAFETY: checked length above.
    let Some(start_x) = start.get(0).unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(start_y) = start.get(1).unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start y must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(end_x) = end.get(0).unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(end_y) = end.get(1).unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end y must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let segment = UnsolvedSegment {
        start: [start_x, start_y],
        end: [end_x, end_y],
        meta: vec![args.source_range.into()],
    };

    // Save the segment to be sent to the engine after solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.needed_by_engine.push(segment.clone());

    let meta = segment.meta.clone();
    let abstract_segment = AbstractSegment {
        repr: SegmentRepr::Unsolved { segment },
        meta,
    };
    Ok(KclValue::Segment {
        value: Box::new(abstract_segment),
    })
}

pub async fn parallel(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    Err(KclError::Internal {
        details: KclErrorDetails::new("Not yet implemented".to_owned(), vec![args.source_range]),
    })
}
