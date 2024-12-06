//! Conversions between types.

use derive_docs::stdlib;

use crate::{
    errors::KclError,
    execution::{ExecState, KclValue},
    std::Args,
};

/// Converts a number to integer.
pub async fn int(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let num = args.get_number()?;
    let converted = inner_int(num)?;

    Ok(args.make_user_val_from_f64(converted))
}

/// Convert a number to an integer.
///
/// DEPRECATED use floor(), ceil(), or round().
///
/// ```no_run
/// let n = int(ceil(5/2))
/// assertEqual(n, 3, 0.0001, "5/2 = 2.5, rounded up makes 3")
/// // Draw n cylinders.
/// startSketchOn('XZ')
///   |> circle({ center = [0, 0], radius = 2 }, %)
///   |> extrude(5, %)
///   |> patternTransform(n, fn(id) {
///   return { translate = [4 * id, 0, 0] }
/// }, %)
/// ```
#[stdlib {
    name = "int",
    tags = ["convert"],
}]
fn inner_int(num: f64) -> Result<f64, KclError> {
    Ok(num)
}
