//! Standard library fillets.

use anyhow::Result;
use indexmap::IndexMap;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::CutType, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DEFAULT_TOLERANCE;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{PrimitiveType, RuntimeType},
        EdgeCut, ExecState, ExtrudeSurface, FilletSurface, GeoMeta, KclValue, Solid, TagIdentifier,
    },
    parsing::ast::types::TagNode,
    std::Args,
    SourceRange,
};

/// A tag or a uuid of an edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Eq, Hash)]
#[ts(export)]
#[serde(untagged)]
pub enum EdgeReference {
    /// A uuid of an edge.
    Uuid(uuid::Uuid),
    /// A tag of an edge.
    Tag(Box<TagIdentifier>),
}

impl EdgeReference {
    pub fn get_engine_id(&self, exec_state: &mut ExecState, args: &Args) -> Result<uuid::Uuid, KclError> {
        match self {
            EdgeReference::Uuid(uuid) => Ok(*uuid),
            EdgeReference::Tag(tag) => Ok(args.get_tag_engine_info(exec_state, tag)?.id),
        }
    }
}

pub(super) fn validate_unique<T: Eq + std::hash::Hash>(tags: &[(T, SourceRange)]) -> Result<(), KclError> {
    // Check if tags contains any duplicate values.
    let mut tag_counts: IndexMap<&T, Vec<SourceRange>> = Default::default();
    for tag in tags {
        tag_counts.entry(&tag.0).or_insert(Vec::new()).push(tag.1);
    }
    let mut duplicate_tags_source = Vec::new();
    for (_tag, count) in tag_counts {
        if count.len() > 1 {
            duplicate_tags_source.extend(count)
        }
    }
    if !duplicate_tags_source.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "The same edge ID is being referenced multiple times, which is not allowed. Please select a different edge".to_string(),
            source_ranges: duplicate_tags_source,
        }));
    }
    Ok(())
}

/// Create fillets on tagged paths.
pub async fn fillet(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg_typed("solid", &RuntimeType::Primitive(PrimitiveType::Solid), exec_state)?;
    let radius = args.get_kw_arg("radius")?;
    let tolerance = args.get_kw_arg_opt("tolerance")?;
    let tags = args.kw_arg_array_and_source::<EdgeReference>("tags")?;
    let tag = args.get_kw_arg_opt("tag")?;

    // Run the function.
    validate_unique(&tags)?;
    let tags: Vec<EdgeReference> = tags.into_iter().map(|item| item.0).collect();
    let value = inner_fillet(solid, radius, tags, tolerance, tag, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

/// Blend a transitional edge along a tagged path, smoothing the sharp edge.
///
/// Fillet is similar in function and use to a chamfer, except
/// a chamfer will cut a sharp transition along an edge while fillet
/// will smoothly blend the transition.
///
/// ```no_run
/// width = 20
/// length = 10
/// thickness = 1
/// filletRadius = 2
///
/// mountingPlateSketch = startSketchOn("XY")
///   |> startProfileAt([-width/2, -length/2], %)
///   |> line(endAbsolute = [width/2, -length/2], tag = $edge1)
///   |> line(endAbsolute = [width/2, length/2], tag = $edge2)
///   |> line(endAbsolute = [-width/2, length/2], tag = $edge3)
///   |> close(tag = $edge4)
///
/// mountingPlate = extrude(mountingPlateSketch, length = thickness)
///   |> fillet(
///     radius = filletRadius,
///     tags = [
///       getNextAdjacentEdge(edge1),
///       getNextAdjacentEdge(edge2),
///       getNextAdjacentEdge(edge3),
///       getNextAdjacentEdge(edge4)
///     ],
///   )
/// ```
///
/// ```no_run
/// width = 20
/// length = 10
/// thickness = 1
/// filletRadius = 1
///
/// mountingPlateSketch = startSketchOn("XY")
///   |> startProfileAt([-width/2, -length/2], %)
///   |> line(endAbsolute = [width/2, -length/2], tag = $edge1)
///   |> line(endAbsolute = [width/2, length/2], tag = $edge2)
///   |> line(endAbsolute = [-width/2, length/2], tag = $edge3)
///   |> close(tag = $edge4)
///
/// mountingPlate = extrude(mountingPlateSketch, length = thickness)
///   |> fillet(
///     radius = filletRadius,
///     tolerance = 0.000001,
///     tags = [
///       getNextAdjacentEdge(edge1),
///       getNextAdjacentEdge(edge2),
///       getNextAdjacentEdge(edge3),
///       getNextAdjacentEdge(edge4)
///     ],
///   )
/// ```
#[stdlib {
    name = "fillet",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        solid = { docs = "The solid whose edges should be filletted" },
        radius = { docs = "The radius of the fillet" },
        tags = { docs = "The paths you want to fillet" },
        tolerance = { docs = "The tolerance for this fillet" },
        tag = { docs = "Create a new tag which refers to this fillet"},
    }
}]
async fn inner_fillet(
    solid: Box<Solid>,
    radius: f64,
    tags: Vec<EdgeReference>,
    tolerance: Option<f64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let mut solid = solid.clone();
    for edge_tag in tags {
        let edge_id = edge_tag.get_engine_id(exec_state, &args)?;

        let id = exec_state.next_uuid();
        args.batch_end_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dFilletEdge {
                edge_id,
                object_id: solid.id,
                radius: LengthUnit(radius),
                tolerance: LengthUnit(tolerance.unwrap_or(DEFAULT_TOLERANCE)),
                cut_type: CutType::Fillet,
            }),
        )
        .await?;

        solid.edge_cuts.push(EdgeCut::Fillet {
            id,
            edge_id,
            radius,
            tag: Box::new(tag.clone()),
        });

        if let Some(ref tag) = tag {
            solid.value.push(ExtrudeSurface::Fillet(FilletSurface {
                face_id: id,
                tag: Some(tag.clone()),
                geo_meta: GeoMeta {
                    id,
                    metadata: args.source_range.into(),
                },
            }));
        }
    }

    Ok(solid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_unique() {
        let dup_a = SourceRange::from([1, 3, 0]);
        let dup_b = SourceRange::from([10, 30, 0]);
        // Two entries are duplicates (abc) with different source ranges.
        let tags = vec![("abc", dup_a), ("abc", dup_b), ("def", SourceRange::from([2, 4, 0]))];
        let actual = validate_unique(&tags);
        // Both the duplicates should show up as errors, with both of the
        // source ranges they correspond to.
        // But the unique source range 'def' should not.
        let expected = vec![dup_a, dup_b];
        assert_eq!(actual.err().unwrap().source_ranges(), expected);
    }
}
