use derive_docs::stdlib;
use schemars::JsonSchema;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{KclValue, SketchGroup, SourceRange, UserVal},
    function_param::FunctionParam,
};

use super::{args::FromArgs, Args, FnAsArg};

/// For each item in an array, update a value.
pub async fn array_reduce(args: Args) -> Result<KclValue, KclError> {
    let (array, start, f): (Vec<u64>, SketchGroup, FnAsArg<'_>) = FromArgs::from_args(&args, 0)?;
    let reduce_fn = FunctionParam {
        inner: f.func,
        fn_expr: f.expr,
        meta: vec![args.source_range.into()],
        ctx: args.ctx.clone(),
        memory: *f.memory,
        dynamic_state: args.dynamic_state.clone(),
    };
    inner_array_reduce(array, start, reduce_fn, &args)
        .await
        .map(|sg| KclValue::UserVal(UserVal::set(sg.meta.clone(), sg)))
}

/// Take a starting value. Then, for each element of an array, calculate the next value,
/// using the previous value and the element.
/// ```no_run
/// fn decagon = (radius) => {
///   let step = (1/10) * tau()
///   let sketch = startSketchAt([(cos(0)*radius), (sin(0) * radius)])
///   return arrayReduce([1..10], sketch, (i, sg) => {
///       let x = cos(step * i) * radius
///       let y = sin(step * i) * radius
///       return lineTo([x, y], sg)
///   })
/// }
/// decagon(5.0) |> close(%)
/// ```
#[stdlib {
    name = "arrayReduce",
}]
async fn inner_array_reduce<'a>(
    array: Vec<u64>,
    start: SketchGroup,
    reduce_fn: FunctionParam<'a>,
    args: &'a Args,
) -> Result<SketchGroup, KclError> {
    let mut reduced = start;
    for i in array {
        reduced = call_reduce_closure(i, reduced, &reduce_fn, args.source_range).await?;
    }

    Ok(reduced)
}

async fn call_reduce_closure<'a>(
    i: u64,
    start: SketchGroup,
    reduce_fn: &FunctionParam<'a>,
    source_range: SourceRange,
) -> Result<SketchGroup, KclError> {
    // Call the reduce fn for this repetition.
    let reduce_fn_args = vec![
        KclValue::UserVal(UserVal {
            value: serde_json::Value::Number(i.into()),
            meta: vec![source_range.into()],
        }),
        KclValue::new_user_val(start.meta.clone(), start),
    ];
    let transform_fn_return = reduce_fn.call(reduce_fn_args).await?;

    // Unpack the returned transform object.
    let source_ranges = vec![source_range];
    let closure_retval = transform_fn_return.ok_or_else(|| {
        KclError::Semantic(KclErrorDetails {
            message: "Reducer function must return a value".to_string(),
            source_ranges: source_ranges.clone(),
        })
    })?;
    let Some(out) = closure_retval.as_user_val() else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Reducer function must return a UserValue".to_string(),
            source_ranges: source_ranges.clone(),
        }));
    };
    let Some((out, _meta)) = out.get() else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Reducer function must return a SketchGroup".to_string(),
            source_ranges: source_ranges.clone(),
        }));
    };
    Ok(out)
}
