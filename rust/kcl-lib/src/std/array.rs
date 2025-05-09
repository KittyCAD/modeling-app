use indexmap::IndexMap;
use kcl_derive_docs::stdlib;

use super::{
    args::{Arg, KwArgs},
    Args,
};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        kcl_value::{FunctionSource, KclValue},
        types::{ArrayLen, RuntimeType},
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

/// Apply a function to every element of a list.
///
/// Given a list like `[a, b, c]`, and a function like `f`, returns
/// `[f(a), f(b), f(c)]`
/// ```no_run
/// r = 10 // radius
/// fn drawCircle(@id) {
///   return startSketchOn(XY)
///     |> circle( center= [id * 2 * r, 0], radius= r)
/// }
///
/// // Call `drawCircle`, passing in each element of the array.
/// // The outputs from each `drawCircle` form a new array,
/// // which is the return value from `map`.
/// circles = map(
///   [1..3],
///   f = drawCircle
/// )
/// ```
/// ```no_run
/// r = 10 // radius
/// // Call `map`, using an anonymous function instead of a named one.
/// circles = map(
///   [1..3],
///   f = fn(@id) {
///     return startSketchOn(XY)
///       |> circle( center= [id * 2 * r, 0], radius= r)
///   }
/// )
/// ```
#[stdlib {
    name = "map",
    keywords = true,
    unlabeled_first = true,
    args = {
        array = { docs = "Input array. The output array is this input array, but every element has had the function `f` run on it." },
        f = { docs = "A function. The output array is just the input array, but `f` has been run on every item." },
    },
    tags = ["array"]
}]
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
        unlabeled: Some(Arg::new(input, source_range)),
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

/// Take a starting value. Then, for each element of an array, calculate the next value,
/// using the previous value and the element.
/// ```no_run
/// // This function adds two numbers.
/// fn add(@a, accum) { return a + accum }
///
/// // This function adds an array of numbers.
/// // It uses the `reduce` function, to call the `add` function on every
/// // element of the `arr` parameter. The starting value is 0.
/// fn sum(@arr) { return reduce(arr, initial = 0, f = add) }
///
/// /*
/// The above is basically like this pseudo-code:
/// fn sum(arr):
///     sumSoFar = 0
///     for i in arr:
///         sumSoFar = add(i, sumSoFar)
///     return sumSoFar
/// */
///
/// // We use `assert` to check that our `sum` function gives the
/// // expected result. It's good to check your work!
/// assert(sum([1, 2, 3]), isEqualTo = 6, tolerance = 0.1, error = "1 + 2 + 3 summed is 6")
/// ```
/// ```no_run
/// // This example works just like the previous example above, but it uses
/// // an anonymous `add` function as its parameter, instead of declaring a
/// // named function outside.
/// arr = [1, 2, 3]
/// sum = reduce(arr, initial = 0, f = fn (@i, accum) { return i + accum })
///
/// // We use `assert` to check that our `sum` function gives the
/// // expected result. It's good to check your work!
/// assert(sum, isEqualTo = 6, tolerance = 0.1, error = "1 + 2 + 3 summed is 6")
/// ```
/// ```no_run
/// // Declare a function that sketches a decagon.
/// fn decagon(@radius) {
///   // Each side of the decagon is turned this many radians from the previous angle.
///   stepAngle = ((1/10) * TAU): number(rad)
///
///   // Start the decagon sketch at this point.
///   startOfDecagonSketch = startSketchOn(XY)
///     |> startProfile(at = [(cos(0)*radius), (sin(0) * radius)])
///
///   // Use a `reduce` to draw the remaining decagon sides.
///   // For each number in the array 1..10, run the given function,
///   // which takes a partially-sketched decagon and adds one more edge to it.
///   fullDecagon = reduce([1..10], initial = startOfDecagonSketch, f = fn(@i, accum) {
///       // Draw one edge of the decagon.
///       x = cos(stepAngle * i) * radius
///       y = sin(stepAngle * i) * radius
///       return line(accum, end = [x, y])
///   })
///
///   return fullDecagon
///
/// }
///
/// /*
/// The `decagon` above is basically like this pseudo-code:
/// fn decagon(radius):
///     stepAngle = ((1/10) * TAU): number(rad)
///     plane = startSketchOn(XY)
///     startOfDecagonSketch = startProfile(plane, at = [(cos(0)*radius), (sin(0) * radius)])
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
    keywords = true,
    unlabeled_first = true,
    args = {
        array = { docs = "Each element of this array gets run through the function `f`, combined with the previous output from `f`, and then used for the next run." },
        initial = { docs = "The first time `f` is run, it will be called with the first item of `array` and this initial starting value."},
        f = { docs = "Run once per item in the input `array`. This function takes an item from the array, and the previous output from `f` (or `initial` on the very first run). The final time `f` is run, its output is returned as the final output from `reduce`." },
    },
    tags = ["array"]
}]
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
        unlabeled: Some(Arg::new(elem, source_range)),
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

pub async fn push(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let array = args.get_unlabeled_kw_arg_typed(
        "array",
        &RuntimeType::Array(Box::new(RuntimeType::any()), ArrayLen::None),
        exec_state,
    )?;
    let item = args.get_kw_arg("item")?;
    inner_push(array, item, &args)
}

/// Append an element to the end of an array.
///
/// Returns a new array with the element appended.
///
/// ```no_run
/// arr = [1, 2, 3]
/// new_arr = push(arr, item = 4)
/// assert(new_arr[3], isEqualTo = 4, tolerance = 0.1, error = "4 was added to the end of the array")
/// ```
#[stdlib {
    name = "push",
    keywords = true,
    unlabeled_first = true,
    args = {
        array = { docs = "The array which you're adding a new item to." },
        item = { docs = "The new item to add to the array" },
    },
    tags = ["array"]
}]
fn inner_push(array: KclValue, item: KclValue, args: &Args) -> Result<KclValue, KclError> {
    let KclValue::HomArray { value: mut values, ty } = array else {
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
        // TODO: The user pushed an item of a different type than the array.
        // What should happen here?
        RuntimeType::any()
    };
    values.push(item);

    Ok(KclValue::HomArray { value: values, ty })
}

pub async fn pop(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let array = args.get_unlabeled_kw_arg_typed(
        "array",
        &RuntimeType::Array(Box::new(RuntimeType::any()), ArrayLen::None),
        exec_state,
    )?;

    inner_pop(array, &args)
}

/// Remove the last element from an array.
///
/// Returns a new array with the last element removed.
///
/// ```no_run
/// arr = [1, 2, 3, 4]
/// new_arr = pop(arr)
/// assert(new_arr[0], isEqualTo = 1, tolerance = 0.00001, error = "1 is the first element of the array")
/// assert(new_arr[1], isEqualTo = 2, tolerance = 0.00001, error = "2 is the second element of the array")
/// assert(new_arr[2], isEqualTo = 3, tolerance = 0.00001, error = "3 is the third element of the array")
/// ```
#[stdlib {
    name = "pop",
    keywords = true,
    unlabeled_first = true,
    args = {
        array = { docs = "The array to pop from. Must not be empty."},
    },
    tags = ["array"]
}]
fn inner_pop(array: KclValue, args: &Args) -> Result<KclValue, KclError> {
    let KclValue::HomArray { value: values, ty } = array else {
        let meta = vec![args.source_range];
        let actual_type = array.human_friendly_type();
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: meta,
            message: format!("You can't pop from a value of type {actual_type}, only an array"),
        }));
    };
    if values.is_empty() {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Cannot pop from an empty array".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Create a new array with all elements except the last one
    let new_array = values[..values.len() - 1].to_vec();

    Ok(KclValue::HomArray { value: new_array, ty })
}
