use indexmap::IndexMap;

use crate::{
    ExecutorContext, SourceRange,
    errors::{KclError, KclErrorDetails},
    execution::{
        ControlFlowKind, ExecState,
        fn_call::{Arg, Args},
        kcl_value::{FunctionSource, KclValue},
        types::RuntimeType,
    },
};

/// Apply a function to each element of an array.
pub async fn map(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let array: Vec<KclValue> = args.get_unlabeled_kw_arg("array", &RuntimeType::any_array(), exec_state)?;
    let f: FunctionSource = args.get_kw_arg("f", &RuntimeType::function(), exec_state)?;
    let new_array = inner_map(array, f, exec_state, &args).await?;
    Ok(KclValue::HomArray {
        value: new_array,
        ty: RuntimeType::any(),
    })
}

async fn inner_map(
    array: Vec<KclValue>,
    f: FunctionSource,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<KclValue>, KclError> {
    let mut new_array = Vec::with_capacity(array.len());
    for elem in array {
        let new_elem = call_map_closure(elem, &f, args.source_range, exec_state, &args.ctx).await?;
        new_array.push(new_elem);
    }
    Ok(new_array)
}

async fn call_map_closure(
    input: KclValue,
    map_fn: &FunctionSource,
    source_range: SourceRange,
    exec_state: &mut ExecState,
    ctxt: &ExecutorContext,
) -> Result<KclValue, KclError> {
    let args = Args::new(
        Default::default(),
        vec![(None, Arg::new(input, source_range))],
        source_range,
        exec_state,
        ctxt.clone(),
        Some("map closure".to_owned()),
    );
    let output = map_fn.call_kw(None, exec_state, ctxt, args, source_range).await?;
    let source_ranges = vec![source_range];
    let output = output.ok_or_else(|| {
        KclError::new_semantic(KclErrorDetails::new(
            "Map function must return a value".to_owned(),
            source_ranges,
        ))
    })?;
    let output = match output.control {
        ControlFlowKind::Continue => output.into_value(),
        ControlFlowKind::Exit => {
            let message = "Early return inside map function is currently not supported".to_owned();
            debug_assert!(false, "{}", &message);
            return Err(KclError::new_internal(KclErrorDetails::new(
                message,
                vec![source_range],
            )));
        }
    };
    Ok(output)
}

/// For each item in an array, update a value.
pub async fn reduce(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let array: Vec<KclValue> = args.get_unlabeled_kw_arg("array", &RuntimeType::any_array(), exec_state)?;
    let f: FunctionSource = args.get_kw_arg("f", &RuntimeType::function(), exec_state)?;
    let initial: KclValue = args.get_kw_arg("initial", &RuntimeType::any(), exec_state)?;
    inner_reduce(array, initial, f, exec_state, &args).await
}

async fn inner_reduce(
    array: Vec<KclValue>,
    initial: KclValue,
    f: FunctionSource,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<KclValue, KclError> {
    let mut reduced = initial;
    for elem in array {
        reduced = call_reduce_closure(elem, reduced, &f, args.source_range, exec_state, &args.ctx).await?;
    }

    Ok(reduced)
}

async fn call_reduce_closure(
    elem: KclValue,
    accum: KclValue,
    reduce_fn: &FunctionSource,
    source_range: SourceRange,
    exec_state: &mut ExecState,
    ctxt: &ExecutorContext,
) -> Result<KclValue, KclError> {
    // Call the reduce fn for this repetition.
    let mut labeled = IndexMap::with_capacity(1);
    labeled.insert("accum".to_string(), Arg::new(accum, source_range));
    let reduce_fn_args = Args::new(
        labeled,
        vec![(None, Arg::new(elem, source_range))],
        source_range,
        exec_state,
        ctxt.clone(),
        Some("reduce closure".to_owned()),
    );
    let transform_fn_return = reduce_fn
        .call_kw(None, exec_state, ctxt, reduce_fn_args, source_range)
        .await?;

    // Unpack the returned transform object.
    let source_ranges = vec![source_range];
    let out = transform_fn_return.ok_or_else(|| {
        KclError::new_semantic(KclErrorDetails::new(
            "Reducer function must return a value".to_string(),
            source_ranges.clone(),
        ))
    })?;
    let out = match out.control {
        ControlFlowKind::Continue => out.into_value(),
        ControlFlowKind::Exit => {
            let message = "Early return inside reduce function is currently not supported".to_owned();
            debug_assert!(false, "{}", &message);
            return Err(KclError::new_internal(KclErrorDetails::new(
                message,
                vec![source_range],
            )));
        }
    };
    Ok(out)
}

pub async fn push(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (mut array, ty) = args.get_unlabeled_kw_arg_array_and_type("array", exec_state)?;
    let item: KclValue = args.get_kw_arg("item", &RuntimeType::any(), exec_state)?;

    array.push(item);

    Ok(KclValue::HomArray { value: array, ty })
}

pub async fn pop(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (mut array, ty) = args.get_unlabeled_kw_arg_array_and_type("array", exec_state)?;
    if array.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot pop from an empty array".to_string(),
            vec![args.source_range],
        )));
    }
    array.pop();
    Ok(KclValue::HomArray { value: array, ty })
}

pub async fn concat(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (left, left_el_ty) = args.get_unlabeled_kw_arg_array_and_type("array", exec_state)?;
    let right_value: KclValue = args.get_kw_arg("items", &RuntimeType::any_array(), exec_state)?;

    match right_value {
        KclValue::HomArray {
            value: right,
            ty: right_el_ty,
            ..
        } => Ok(inner_concat(&left, &left_el_ty, &right, &right_el_ty)),
        KclValue::Tuple { value: right, .. } => {
            // Tuples are treated as arrays for concatenation.
            Ok(inner_concat(&left, &left_el_ty, &right, &RuntimeType::any()))
        }
        // Any single value is a subtype of an array, so we can treat it as a
        // single-element array.
        _ => Ok(inner_concat(&left, &left_el_ty, &[right_value], &RuntimeType::any())),
    }
}

fn inner_concat(
    left: &[KclValue],
    left_el_ty: &RuntimeType,
    right: &[KclValue],
    right_el_ty: &RuntimeType,
) -> KclValue {
    if left.is_empty() {
        return KclValue::HomArray {
            value: right.to_vec(),
            ty: right_el_ty.clone(),
        };
    }
    if right.is_empty() {
        return KclValue::HomArray {
            value: left.to_vec(),
            ty: left_el_ty.clone(),
        };
    }
    let mut new = left.to_vec();
    new.extend_from_slice(right);
    // Propagate the element type if we can.
    let ty = if right_el_ty.subtype(left_el_ty) {
        left_el_ty.clone()
    } else if left_el_ty.subtype(right_el_ty) {
        right_el_ty.clone()
    } else {
        RuntimeType::any()
    };
    KclValue::HomArray { value: new, ty }
}

pub async fn slice(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (array, ty) = args.get_unlabeled_kw_arg_array_and_type("array", exec_state)?;
    let start: Option<i64> = args.get_kw_arg_opt("start", &RuntimeType::count(), exec_state)?;
    let end: Option<i64> = args.get_kw_arg_opt("end", &RuntimeType::count(), exec_state)?;

    if start.is_none() && end.is_none() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "The `slice` function requires at least one of `start` or `end`".to_owned(),
            vec![args.source_range],
        )));
    }

    let len = array.len() as i64;
    let mut start_idx = start.unwrap_or(0);
    let mut end_idx = end.unwrap_or(len);

    if start_idx < 0 {
        start_idx += len;
    }
    if end_idx < 0 {
        end_idx += len;
    }

    if start_idx < 0 || start_idx > len {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("Slice start index {start_idx} is out of bounds for array of length {len}"),
            vec![args.source_range],
        )));
    }
    if end_idx < 0 || end_idx > len {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("Slice end index {end_idx} is out of bounds for array of length {len}"),
            vec![args.source_range],
        )));
    }
    if start_idx > end_idx {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Slice start index {start_idx} must be less than or equal to end index {end_idx}"
            ),
            vec![args.source_range],
        )));
    }

    let slice = array[start_idx as usize..end_idx as usize].to_vec();
    Ok(KclValue::HomArray { value: slice, ty })
}

pub async fn flatten(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let array_value: KclValue = args.get_unlabeled_kw_arg("array", &RuntimeType::any_array(), exec_state)?;
    let mut flattened = Vec::new();

    let (array, original_ty) = match array_value {
        KclValue::HomArray { value, ty, .. } => (value, ty),
        KclValue::Tuple { value, .. } => (value, RuntimeType::any()),
        _ => (vec![array_value], RuntimeType::any()),
    };
    for elem in array {
        match elem {
            KclValue::HomArray { value, .. } => flattened.extend(value),
            KclValue::Tuple { value, .. } => flattened.extend(value),
            _ => flattened.push(elem),
        }
    }

    let ty = infer_flattened_type(original_ty, &flattened);
    Ok(KclValue::HomArray { value: flattened, ty })
}

/// Infer the type of a flattened array based on the original type and the
/// types of the flattened values. Currently, we preserve the original type only
/// if all flattened values have the same type as the original element type.
/// Otherwise, we fall back to `any`.
fn infer_flattened_type(original_ty: RuntimeType, values: &[KclValue]) -> RuntimeType {
    for value in values {
        if !value.has_type(&original_ty) {
            return RuntimeType::any();
        };
    }

    original_ty
}
