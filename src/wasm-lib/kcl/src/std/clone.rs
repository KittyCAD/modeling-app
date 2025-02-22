//! Standard library clone.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};

use crate::{
    errors::KclError,
    execution::{ExecState, Geometry, KclValue},
    std::Args,
};

/// Clone a sketch or solid.
///
/// This works essentially like a copy-paste operation.
pub async fn clone(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let geometry = args.get_geometry()?;

    let cloned = inner_clone(geometry, exec_state, args).await?;
    Ok(cloned.into())
}

// TODO(jessfraz): these examples kinda such without transforms, fix them once those
// are implemented.
//
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
/// ```
#[stdlib {
    name = "clone",
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
