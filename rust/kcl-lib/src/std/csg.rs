//! Constructive Solid Geometry (CSG) operations.

use anyhow::Result;
use kcl_derive_docs::stdlib;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{types::RuntimeType, ExecState, KclValue, Solid},
    std::Args,
};

/// Union two or more solids into a single solid.
pub async fn union(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> =
        args.get_unlabeled_kw_arg_typed("solids", &RuntimeType::Union(vec![RuntimeType::solids()]), exec_state)?;

    if solids.len() < 2 {
        return Err(KclError::UndefinedValue(KclErrorDetails {
            message: "At least two solids are required for a union operation.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let solids = inner_union(solids, exec_state, args).await?;
    Ok(solids.into())
}

/// Union two or more solids into a single solid.
///
/// ```no_run
/// // Union two cubes using the stdlib functions.
///
/// fn cube(center) {
///     return startSketchOn('XY')
///         |> startProfileAt([center[0] - 10, center[1] - 10], %)
///         |> line(endAbsolute = [center[0] + 10, center[1] - 10])
///         |> line(endAbsolute = [center[0] + 10, center[1] + 10])
///         |> line(endAbsolute = [center[0] - 10, center[1] + 10])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube([0, 0])
/// part002 = cube([20, 10])
///
/// unionedPart = union([part001, part002])
/// ```
///
/// ```no_run
/// // Union two cubes using operators.
///
/// fn cube(center) {
///     return startSketchOn('XY')
///         |> startProfileAt([center[0] - 10, center[1] - 10], %)
///         |> line(endAbsolute = [center[0] + 10, center[1] - 10])
///         |> line(endAbsolute = [center[0] + 10, center[1] + 10])
///         |> line(endAbsolute = [center[0] - 10, center[1] + 10])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube([0, 0])
/// part002 = cube([20, 10])
///
/// // This is the equivalent of: union([part001, part002])
/// unionedPart = part001 + part002
/// ```
#[stdlib {
    name = "union",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    deprecated = true,
    args = {
        solids = {docs = "The solids to union."},
    }
}]
pub(crate) async fn inner_union(
    solids: Vec<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    // Flush the fillets for the solids.
    args.flush_batch_for_solids(exec_state, &solids).await?;

    // TODO: call the engine union operation.
    // TODO: figure out all the shit after for the faces etc.

    // For now just return the first solid.
    // Til we have a proper implementation.
    Ok(vec![solids[0].clone()])
}

/// Intersect returns the shared volume between multiple solids, preserving only
/// overlapping regions.
pub async fn intersect(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> = args.get_unlabeled_kw_arg_typed("solids", &RuntimeType::solids(), exec_state)?;

    if solids.len() < 2 {
        return Err(KclError::UndefinedValue(KclErrorDetails {
            message: "At least two solids are required for an intersect operation.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let solids = inner_intersect(solids, exec_state, args).await?;
    Ok(solids.into())
}

/// Intersect returns the shared volume between multiple solids, preserving only
/// overlapping regions.
///
/// Intersect computes the geometric intersection of multiple solid bodies,
/// returning a new solid representing the volume that is common to all input
/// solids. This operation is useful for determining shared material regions,
/// verifying fit, and analyzing overlapping geometries in assemblies.
///
/// ```no_run
/// fn cube(center) {
///     return startSketchOn('XY')
///         |> startProfileAt([center[0] - 10, center[1] - 10], %)
///         |> line(endAbsolute = [center[0] + 10, center[1] - 10])
///         |> line(endAbsolute = [center[0] + 10, center[1] + 10])
///         |> line(endAbsolute = [center[0] - 10, center[1] + 10])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube([0, 0])
/// part002 = cube([8, 8])
///
/// intersectedPart = intersect([part001, part002])
/// ```
#[stdlib {
    name = "intersect",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    deprecated = true,
    args = {
        solids = {docs = "The solids to intersect."},
    }
}]
async fn inner_intersect(solids: Vec<Solid>, exec_state: &mut ExecState, args: Args) -> Result<Vec<Solid>, KclError> {
    // Flush the fillets for the solids.
    args.flush_batch_for_solids(exec_state, &solids).await?;

    // TODO: call the engine union operation.
    // TODO: figure out all the shit after for the faces etc.

    // For now just return the first solid.
    // Til we have a proper implementation.
    Ok(vec![solids[0].clone()])
}

/// Subtract removes tool solids from base solids, leaving the remaining material.
pub async fn subtract(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> = args.get_unlabeled_kw_arg_typed("solids", &RuntimeType::solids(), exec_state)?;
    let tools: Vec<Solid> = args.get_kw_arg_typed("tools", &RuntimeType::solids(), exec_state)?;

    let solids = inner_subtract(solids, tools, exec_state, args).await?;
    Ok(solids.into())
}

/// Subtract removes tool solids from base solids, leaving the remaining material.
///
/// Performs a boolean subtraction operation, removing the volume of one or more
/// tool solids from one or more base solids. The result is a new solid
/// representing the material that remains after all tool solids have been cut
/// away. This function is essential for machining simulations, cavity creation,
/// and complex multi-body part modeling.
///
/// ```no_run
/// // Subtract a cylinder from a cube using the stdlib functions.
///
/// fn cube(center) {
///     return startSketchOn('XY')
///         |> startProfileAt([center[0] - 10, center[1] - 10], %)
///         |> line(endAbsolute = [center[0] + 10, center[1] - 10])
///         |> line(endAbsolute = [center[0] + 10, center[1] + 10])
///         |> line(endAbsolute = [center[0] - 10, center[1] + 10])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube([0, 0])
/// part002 = startSketchOn('XY')
///     |> circle(center = [0, 0], radius = 2)
///     |> extrude(length = 10)
///
/// subtractedPart = subtract([part001], tools=[part002])
/// ```
///
/// ```no_run
/// // Subtract a cylinder from a cube using operators.
///
/// fn cube(center) {
///     return startSketchOn('XY')
///         |> startProfileAt([center[0] - 10, center[1] - 10], %)
///         |> line(endAbsolute = [center[0] + 10, center[1] - 10])
///         |> line(endAbsolute = [center[0] + 10, center[1] + 10])
///         |> line(endAbsolute = [center[0] - 10, center[1] + 10])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube([0, 0])
/// part002 = startSketchOn('XY')
///     |> circle(center = [0, 0], radius = 2)
///     |> extrude(length = 10)
///
/// // This is the equivalent of: subtract([part001], tools=[part002])
/// subtractedPart = part001 - part002
/// ```
#[stdlib {
    name = "subtract",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    deprecated = true,
    args = {
        solids = {docs = "The solids to use as the base to subtract from."},
        tools = {docs = "The solids to subtract."},
    }
}]
pub(crate) async fn inner_subtract(
    solids: Vec<Solid>,
    tools: Vec<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    // Flush the fillets for the solids and the tools.
    let combined_solids = solids.iter().chain(tools.iter()).cloned().collect::<Vec<Solid>>();
    args.flush_batch_for_solids(exec_state, &combined_solids).await?;

    // TODO: call the engine union operation.
    // TODO: figure out all the shit after for the faces etc.

    // For now just return the first solid.
    // Til we have a proper implementation.
    Ok(vec![solids[0].clone()])
}
