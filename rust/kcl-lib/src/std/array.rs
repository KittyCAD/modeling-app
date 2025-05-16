use indexmap::IndexMap;

use super::{
    args::{Arg, KwArgs},
    Args,
};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        kcl_value::{FunctionSource, KclValue},
        types::RuntimeType,
        ExecState,
    },
    source_range::SourceRange,
    ExecutorContext,
};

/// Apply a function to each element of an array.
pub async fn map(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let array: Vec<KclValue> = args.get_unlabeled_kw_arg("array")?;
    let f: &FunctionSource = args.get_kw_arg("f")?;
    let new_array = inner_map(array, f, exec_state, &args).await?;
    Ok(KclValue::HomArray {
        value: new_array,
        ty: RuntimeType::any(),
    })
}

async fn inner_map<'a>(
    array: Vec<KclValue>,
    f: &'a FunctionSource,
    exec_state: &mut ExecState,
    args: &'a Args,
) -> Result<Vec<KclValue>, KclError> {
    let mut new_array = Vec::with_capacity(array.len());
    for elem in array {
        let new_elem = call_map_closure(elem, f, args.source_range, exec_state, &args.ctx).await?;
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
        KclError::Semantic(KclErrorDetails {
            message: "Map function must return a value".to_string(),
            source_ranges,
        })
    })?;
    Ok(output)
}

/// For each item in an array, update a value.
pub async fn reduce(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let array: Vec<KclValue> = args.get_unlabeled_kw_arg("array")?;
    let f: &FunctionSource = args.get_kw_arg("f")?;
    let initial: KclValue = args.get_kw_arg("initial")?;
    inner_reduce(array, initial, f, exec_state, &args).await
}

async fn inner_reduce<'a>(
    array: Vec<KclValue>,
    initial: KclValue,
    f: &'a FunctionSource,
    exec_state: &mut ExecState,
    args: &'a Args,
) -> Result<KclValue, KclError> {
    let mut reduced = initial;
    for elem in array {
        reduced = call_reduce_closure(elem, reduced, f, args.source_range, exec_state, &args.ctx).await?;
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
        KclError::Semantic(KclErrorDetails {
            message: "Reducer function must return a value".to_string(),
            source_ranges: source_ranges.clone(),
        })
    })?;
    Ok(out)
}

pub async fn push(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let array = args.get_unlabeled_kw_arg("array")?;
    let item: KclValue = args.get_kw_arg("item")?;

    let KclValue::HomArray { value: values, ty } = array else {
        let meta = vec![args.source_range];
        let actual_type = array.human_friendly_type();
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: meta,
            message: format!("You can't push to a value of type {actual_type}, only an array"),
        }));
    };
    let ty = if item.has_type(&ty) {
        ty
    } else {
        // The user pushed an item with a type that differs from the array's
        // element type.
        RuntimeType::any()
    };

    let new_array = inner_push(values, item);

    Ok(KclValue::HomArray { value: new_array, ty })
}

fn inner_push(mut array: Vec<KclValue>, item: KclValue) -> Vec<KclValue> {
    array.push(item);
    array
}

pub async fn pop(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let array = args.get_unlabeled_kw_arg("array")?;
    let KclValue::HomArray { value: values, ty } = array else {
        let meta = vec![args.source_range];
        let actual_type = array.human_friendly_type();
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: meta,
            message: format!("You can't pop from a value of type {actual_type}, only an array"),
        }));
    };

    let new_array = inner_pop(values, &args)?;
    Ok(KclValue::HomArray { value: new_array, ty })
}

fn inner_pop(array: Vec<KclValue>, args: &Args) -> Result<Vec<KclValue>, KclError> {
    if array.is_empty() {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Cannot pop from an empty array".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Create a new array with all elements except the last one
    let new_array = array[..array.len() - 1].to_vec();

    Ok(new_array)
}
