use derive_docs::stdlib;

use super::{
    args::{Arg, FromArgs},
    Args,
};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        kcl_value::{FunctionSource, KclValue},
        ExecState,
    },
    source_range::SourceRange,
    ExecutorContext,
};

/// Apply a function to each element of an array.
pub async fn map(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (array, f): (Vec<KclValue>, &FunctionSource) = FromArgs::from_args(&args, 0)?;
    let meta = vec![args.source_range.into()];
    let new_array = inner_map(array, f, exec_state, &args).await?;
    Ok(KclValue::Array { value: new_array, meta })
}

/// Apply a function to every element of a list.
///
/// Given a list like `[a, b, c]`, and a function like `f`, returns
/// `[f(a), f(b), f(c)]`
/// ```no_run
/// r = 10 // radius
/// fn drawCircle(id) {
///   return startSketchOn("XY")
///     |> circle({ center: [id * 2 * r, 0], radius: r}, %)
/// }
///
/// // Call `drawCircle`, passing in each element of the array.
/// // The outputs from each `drawCircle` form a new array,
/// // which is the return value from `map`.
/// circles = map(
///   [1..3],
///   drawCircle
/// )
/// ```
/// ```no_run
/// r = 10 // radius
/// // Call `map`, using an anonymous function instead of a named one.
/// circles = map(
///   [1..3],
///   fn(id) {
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
    map_fn: &'a FunctionSource,
    exec_state: &mut ExecState,
    args: &'a Args,
) -> Result<Vec<KclValue>, KclError> {
    let mut new_array = Vec::with_capacity(array.len());
    for elem in array {
        let new_elem = call_map_closure(elem, map_fn, args.source_range, exec_state, &args.ctx).await?;
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
    let output = map_fn
        .call(exec_state, ctxt, vec![Arg::synthetic(input)], source_range)
        .await?;
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
    let (array, start, f): (Vec<KclValue>, KclValue, &FunctionSource) = FromArgs::from_args(&args, 0)?;
    inner_reduce(array, start, f, exec_state, &args).await
}

/// Take a starting value. Then, for each element of an array, calculate the next value,
/// using the previous value and the element.
/// ```no_run
/// // This function adds two numbers.
/// fn add(a, b) { return a + b }
///
/// // This function adds an array of numbers.
/// // It uses the `reduce` function, to call the `add` function on every
/// // element of the `arr` parameter. The starting value is 0.
/// fn sum(arr) { return reduce(arr, 0, add) }
///
/// /*
/// The above is basically like this pseudo-code:
/// fn sum(arr):
///     sumSoFar = 0
///     for i in arr:
///         sumSoFar = add(sumSoFar, i)
///     return sumSoFar
/// */
///
/// // We use `assertEqual` to check that our `sum` function gives the
/// // expected result. It's good to check your work!
/// assertEqual(sum([1, 2, 3]), 6, 0.00001, "1 + 2 + 3 summed is 6")
/// ```
/// ```no_run
/// // This example works just like the previous example above, but it uses
/// // an anonymous `add` function as its parameter, instead of declaring a
/// // named function outside.
/// arr = [1, 2, 3]
/// sum = reduce(arr, 0, (i, result_so_far) => { return i + result_so_far })
///
/// // We use `assertEqual` to check that our `sum` function gives the
/// // expected result. It's good to check your work!
/// assertEqual(sum, 6, 0.00001, "1 + 2 + 3 summed is 6")
/// ```
/// ```no_run
/// // Declare a function that sketches a decagon.
/// fn decagon(radius) {
///   // Each side of the decagon is turned this many degrees from the previous angle.
///   stepAngle = (1/10) * TAU
///
///   // Start the decagon sketch at this point.
///   startOfDecagonSketch = startSketchOn('XY')
///     |> startProfileAt([(cos(0)*radius), (sin(0) * radius)], %)
///
///   // Use a `reduce` to draw the remaining decagon sides.
///   // For each number in the array 1..10, run the given function,
///   // which takes a partially-sketched decagon and adds one more edge to it.
///   fullDecagon = reduce([1..10], startOfDecagonSketch, fn(i, partialDecagon) {
///       // Draw one edge of the decagon.
///       x = cos(stepAngle * i) * radius
///       y = sin(stepAngle * i) * radius
///       return line(partialDecagon, end = [x, y])
///   })
///
///   return fullDecagon
///
/// }
///
/// /*
/// The `decagon` above is basically like this pseudo-code:
/// fn decagon(radius):
///     stepAngle = (1/10) * TAU
///     plane = startSketchOn('XY')
///     startOfDecagonSketch = startProfileAt([(cos(0)*radius), (sin(0) * radius)], plane)
///
///     // Here's the reduce part.
///     partialDecagon = startOfDecagonSketch
///     for i in [1..10]:
///         x = cos(stepAngle * i) * radius
///         y = sin(stepAngle * i) * radius
///         partialDecagon = line(partialDecagon, end = [x, y])
///     fullDecagon = partialDecagon // it's now full
///     return fullDecagon
/// */
///
/// // Use the `decagon` function declared above, to sketch a decagon with radius 5.
/// decagon(5.0) |> close()
/// ```
#[stdlib {
    name = "reduce",
}]
async fn inner_reduce<'a>(
    array: Vec<KclValue>,
    start: KclValue,
    reduce_fn: &'a FunctionSource,
    exec_state: &mut ExecState,
    args: &'a Args,
) -> Result<KclValue, KclError> {
    let mut reduced = start;
    for elem in array {
        reduced = call_reduce_closure(elem, reduced, reduce_fn, args.source_range, exec_state, &args.ctx).await?;
    }

    Ok(reduced)
}

async fn call_reduce_closure(
    elem: KclValue,
    start: KclValue,
    reduce_fn: &FunctionSource,
    source_range: SourceRange,
    exec_state: &mut ExecState,
    ctxt: &ExecutorContext,
) -> Result<KclValue, KclError> {
    // Call the reduce fn for this repetition.
    let reduce_fn_args = vec![Arg::synthetic(elem), Arg::synthetic(start)];
    let transform_fn_return = reduce_fn.call(exec_state, ctxt, reduce_fn_args, source_range).await?;

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

/// Append an element to the end of an array.
///
/// Returns a new array with the element appended.
///
/// ```no_run
/// arr = [1, 2, 3]
/// new_arr = push(arr, 4)
/// assertEqual(new_arr[3], 4, 0.00001, "4 was added to the end of the array")
/// ```
#[stdlib {
    name = "push",
}]
async fn inner_push(mut array: Vec<KclValue>, elem: KclValue, args: &Args) -> Result<KclValue, KclError> {
    // Unwrap the KclValues to JValues for manipulation
    array.push(elem);
    Ok(KclValue::Array {
        value: array,
        meta: vec![args.source_range.into()],
    })
}

pub async fn push(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    // Extract the array and the element from the arguments
    let (val, elem): (KclValue, KclValue) = FromArgs::from_args(&args, 0)?;

    let meta = vec![args.source_range];
    let KclValue::Array { value: array, meta: _ } = val else {
        let actual_type = val.human_friendly_type();
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: meta,
            message: format!("You can't push to a value of type {actual_type}, only an array"),
        }));
    };
    inner_push(array, elem, &args).await
}

/// Remove the last element from an array.
///
/// Returns a new array with the last element removed.
///
/// ```no_run
/// arr = [1, 2, 3, 4]
/// new_arr = pop(arr)
/// assertEqual(new_arr[0], 1, 0.00001, "1 is the first element of the array")
/// assertEqual(new_arr[1], 2, 0.00001, "2 is the second element of the array")
/// assertEqual(new_arr[2], 3, 0.00001, "3 is the third element of the array")
/// ```
#[stdlib {
    name = "pop",
    keywords = true,
    unlabeled_first = true,
    args = {
        array = { docs = "The array to pop from.  Must not be empty."},
    }
}]
async fn inner_pop(array: Vec<KclValue>, args: &Args) -> Result<KclValue, KclError> {
    if array.is_empty() {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Cannot pop from an empty array".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Create a new array with all elements except the last one
    let new_array = array[..array.len() - 1].to_vec();

    Ok(KclValue::Array {
        value: new_array,
        meta: vec![args.source_range.into()],
    })
}

pub async fn pop(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    // Extract the array from the arguments
    let val = args.get_unlabeled_kw_arg("array")?;

    let meta = vec![args.source_range];
    let KclValue::Array { value: array, meta: _ } = val else {
        let actual_type = val.human_friendly_type();
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: meta,
            message: format!("You can't pop from a value of type {actual_type}, only an array"),
        }));
    };

    inner_pop(array, &args).await
}
