//! Conversions between types.

use derive_docs::stdlib;

use crate::{
    errors::KclError,
    execution::{ExecState, KclValue},
    std::Args,
};

/// Converts a number to integer.
pub async fn int(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let num = args.get_number_with_type()?;
    let converted = inner_int(num.n)?;

    Ok(args.make_user_val_from_f64_with_type(num.map(converted)))
}

/// Convert a number to an integer.
///
/// DEPRECATED use floor(), ceil(), or round().
///
/// ```no_run
/// n = int(ceil(5/2))
/// assertEqual(n, 3, 0.0001, "5/2 = 2.5, rounded up makes 3")
/// // Draw n cylinders.
/// startSketchOn('XZ')
///   |> circle({ center = [0, 0], radius = 2 }, %)
///   |> extrude(length = 5)
///   |> patternTransform(instances = n, transform = fn(id) {
///   return { translate = [4 * id, 0, 0] }
/// })
/// ```
#[stdlib {
    name = "int",
    tags = ["convert"],
    deprecated = true,
}]
fn inner_int(num: f64) -> Result<f64, KclError> {
    Ok(num)
}
