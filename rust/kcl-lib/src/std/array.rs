use indexmap::IndexMap;

use crate::{
    ExecutorContext,
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState,
        fn_call::{Arg, Args, KwArgs},
        kcl_value::{FunctionSource, KclValue},
        types::RuntimeType,
    },
    source_range::SourceRange,
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
    let kw_args = KwArgs {
        unlabeled: Some((None, Arg::new(input, source_range))),
        labeled: Default::default(),
        errors: Vec::new(),
    };
    let args = Args::new_kw(
        kw_args,
        source_range,
        ctxt.clone(),
        exec_state.pipe_value().map(|v| Arg::new(v.clone(), source_range)),
    );
    let output = map_fn.call_kw(None, exec_state, ctxt, args, source_range).await?;
    let source_ranges = vec![source_range];
    let output = output.ok_or_else(|| {
        KclError::new_semantic(KclErrorDetails::new(
            "Map function must return a value".to_owned(),
            source_ranges,
        ))
    })?;
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
    let kw_args = KwArgs {
        unlabeled: Some((None, Arg::new(elem, source_range))),
        labeled,
        errors: Vec::new(),
    };
    let reduce_fn_args = Args::new_kw(
        kw_args,
        source_range,
        ctxt.clone(),
        exec_state.pipe_value().map(|v| Arg::new(v.clone(), source_range)),
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
