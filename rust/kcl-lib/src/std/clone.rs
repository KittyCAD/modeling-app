//! Standard library clone.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};

use crate::{
    errors::KclError,
    execution::{
        types::{PrimitiveType, RuntimeType},
        ExecState, Geometry, KclValue,
    },
    std::Args,
};

/// Clone a sketch or solid.
///
/// This works essentially like a copy-paste operation.
pub async fn clone(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let geometry = args.get_unlabeled_kw_arg_typed(
        "geometry",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Sketch),
            RuntimeType::Primitive(PrimitiveType::Solid),
        ]),
        exec_state,
    )?;

    let cloned = inner_clone(geometry, exec_state, args).await?;
    Ok(cloned.into())
}

/// Clone a sketch or solid.
///
/// This works essentially like a copy-paste operation.
///
/// ```no_run
/// exampleSketch = startSketchOn("XY")
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// clonedSketch = clone(exampleSketch)
///     |> scale(
///     x = 1.0,
///     y = 1.0,
///     z = 2.5,
///     )
///     |> translate(
///         x = 15.0,
///         y = 0,
///         z = 0,
///     )
///     |> extrude(length = 5)
/// ```
///
/// ```no_run
/// exampleSketch = startSketchOn("XY")
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// myPart = extrude(exampleSketch, length = 5)
/// clonedPart = clone(myPart)
///     |> translate(
///         x = 25.0,
///         y = 0.0,
///         z = 0,
///     )
/// ```
///
/// ```no_run
/// // Translate and rotate a cloned sketch to create a loft.
/// sketch001 = startSketchOn('XY')
///         |> startProfileAt([-10, 10], %)
///         |> xLine(length = 20)
///         |> yLine(length = -20)
///         |> xLine(length = -20)
///         |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///         |> close()
///
/// sketch002 = clone(sketch001)
///     |> translate(x = 0, y = 0, z = 20)
///     |> rotate(axis = [0, 0, 1.0], angle = 45)
///
/// loft([sketch001, sketch002])
/// ```
#[stdlib {
    name = "clone",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        geometry = { docs = "The sketch or solid to be cloned" },
    }
}]
async fn inner_clone(geometry: Geometry, exec_state: &mut ExecState, args: Args) -> Result<Geometry, KclError> {
    let new_id = exec_state.next_uuid();
    let old_id = geometry.id();

    let new_geometry = match geometry {
        Geometry::Sketch(sketch) => {
            let mut new_sketch = sketch.clone();
            new_sketch.id = new_id;
            Geometry::Sketch(new_sketch)
        }
        Geometry::Solid(solid) => {
            let mut new_solid = solid.clone();
            new_solid.id = new_id;
            Geometry::Solid(new_solid)
        }
    };

    if args.ctx.no_engine_commands().await {
        return Ok(new_geometry);
    }

    args.batch_modeling_cmd(
        exec_state.next_uuid(),
        ModelingCmd::from(mcmd::EntityClone { entity_id: old_id }),
    )
    .await?;

    Ok(new_geometry)
}
