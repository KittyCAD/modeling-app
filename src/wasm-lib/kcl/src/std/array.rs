use derive_docs::stdlib;
use serde_json::Value as JValue;

use super::{args::FromArgs, Args, FnAsArg};
use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExecState, KclValue, SourceRange, UserVal},
    function_param::FunctionParam,
};

/// Apply a function to each element of an array.
pub async fn map(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (array, f): (Vec<JValue>, FnAsArg<'_>) = FromArgs::from_args(&args, 0)?;
    let array: Vec<KclValue> = array
        .into_iter()
        .map(|jval| {
            KclValue::UserVal(UserVal {
                value: jval,
                meta: vec![args.source_range.into()],
            })
        })
        .collect();
    let map_fn = FunctionParam {
        inner: f.func,
        fn_expr: f.expr,
        meta: vec![args.source_range.into()],
        ctx: args.ctx.clone(),
        memory: *f.memory,
    };
    let new_array = inner_map(array, map_fn, exec_state, &args).await?;
    let uv = UserVal::new(vec![args.source_range.into()], new_array);
    Ok(KclValue::UserVal(uv))
}

/// Apply a function to every element of a list.
///
/// Given a list like `[a, b, c]`, and a function like `f`, returns
/// `[f(a), f(b), f(c)]`
/// ```no_run
/// const r = 10 // radius
/// fn drawCircle = (id) => {
///   return startSketchOn("XY")
///     |> circle({ center: [id * 2 * r, 0], radius: r}, %)
/// }
///
/// // Call `drawCircle`, passing in each element of the array.
/// // The outputs from each `drawCircle` form a new array,
/// // which is the return value from `map`.
/// const circles = map(
///   [1..3],
///   drawCircle
/// )
/// ```
/// ```no_run
/// const r = 10 // radius
/// // Call `map`, using an anonymous function instead of a named one.
/// const circles = map(
///   [1..3],
///   (id) => {
///     return startSketchOn("XY")
///       |> circle({ center: [id * 2 * r, 0], radius: r}, %)
///   }
/// )
/// ```
#[stdlib {
    name = "map",
}]
async fn inner_map<'a>(
    array: Vec<KclValue>,
    map_fn: FunctionParam<'a>,
    exec_state: &mut ExecState,
    args: &'a Args,
) -> Result<Vec<KclValue>, KclError> {
    let mut new_array = Vec::with_capacity(array.len());
    for elem in array {
        let new_elem = call_map_closure(elem, &map_fn, args.source_range, exec_state).await?;
        new_array.push(new_elem);
    }
    Ok(new_array)
}

async fn call_map_closure<'a>(
    input: KclValue,
    map_fn: &FunctionParam<'a>,
    source_range: SourceRange,
    exec_state: &mut ExecState,
) -> Result<KclValue, KclError> {
    let output = map_fn.call(exec_state, vec![input]).await?;
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
    let (array, start, f): (Vec<JValue>, KclValue, FnAsArg<'_>) = FromArgs::from_args(&args, 0)?;
    let array: Vec<KclValue> = array
        .into_iter()
        .map(|jval| {
            KclValue::UserVal(UserVal {
                value: jval,
                meta: vec![args.source_range.into()],
            })
        })
        .collect();
    let reduce_fn = FunctionParam {
        inner: f.func,
        fn_expr: f.expr,
        meta: vec![args.source_range.into()],
        ctx: args.ctx.clone(),
        memory: *f.memory,
    };
    inner_reduce(array, start, reduce_fn, exec_state, &args).await
}

/// Take a starting value. Then, for each element of an array, calculate the next value,
/// using the previous value and the element.
/// ```no_run
/// fn decagon = (radius) => {
///   let step = (1/10) * tau()
///   let sketch001 = startSketchAt([(cos(0)*radius), (sin(0) * radius)])
///   return reduce([1..10], sketch001, (i, sg) => {
///       let x = cos(step * i) * radius
///       let y = sin(step * i) * radius
///       return lineTo([x, y], sg)
///   })
/// }
/// decagon(5.0) |> close(%)
/// ```
/// ```no_run
/// array = [1, 2, 3]
/// sum = reduce(array, 0, (i, result_so_far) => { return i + result_so_far })
/// assertEqual(sum, 6, 0.00001, "1 + 2 + 3 summed is 6")
/// ```
/// ```no_run
/// fn add = (a, b) => { return a + b }
/// fn sum = (array) => { return reduce(array, 0, add) }
/// assertEqual(sum([1, 2, 3]), 6, 0.00001, "1 + 2 + 3 summed is 6")
/// ```
#[stdlib {
    name = "reduce",
}]
async fn inner_reduce<'a>(
    array: Vec<KclValue>,
    start: KclValue,
    reduce_fn: FunctionParam<'a>,
    exec_state: &mut ExecState,
    args: &'a Args,
) -> Result<KclValue, KclError> {
    let mut reduced = start;
    for elem in array {
        reduced = call_reduce_closure(elem, reduced, &reduce_fn, args.source_range, exec_state).await?;
    }

    Ok(reduced)
}

async fn call_reduce_closure<'a>(
    elem: KclValue,
    start: KclValue,
    reduce_fn: &FunctionParam<'a>,
    source_range: SourceRange,
    exec_state: &mut ExecState,
) -> Result<KclValue, KclError> {
    // Call the reduce fn for this repetition.
    let reduce_fn_args = vec![elem, start];
    let transform_fn_return = reduce_fn.call(exec_state, reduce_fn_args).await?;

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
