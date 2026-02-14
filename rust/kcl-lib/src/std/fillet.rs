//! Standard library fillets.

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::{CutType, CutTypeV2}};
use kittycad_modeling_cmds as kcmc;
use serde::{Deserialize, Serialize};

use super::{DEFAULT_TOLERANCE_MM, args::TyF64};
use crate::{
    SourceRange,
    errors::{KclError, KclErrorDetails},
    execution::{
        EdgeCut, ExecState, ExtrudeSurface, FilletSurface, GeoMeta, KclValue, ModelingCmdMeta, Solid, TagIdentifier,
        types::RuntimeType,
    },
    parsing::ast::types::TagNode,
    std::Args,
};

/// A tag or a uuid of an edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
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
        return Err(KclError::new_type(KclErrorDetails::new(
            "The same edge ID is being referenced multiple times, which is not allowed. Please select a different edge"
                .to_string(),
            duplicate_tags_source,
        )));
    }
    Ok(())
}

// EdgeRef is parsed directly from KclValue, no need for a separate struct

/// Create fillets on tagged paths.
pub async fn fillet(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let radius: TyF64 = args.get_kw_arg("radius", &RuntimeType::length(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let tag = args.get_kw_arg_opt("tag", &RuntimeType::tag_decl(), exec_state)?;
    
    // Check if edgeRefs is provided (new API)
    let edge_refs: Option<Vec<KclValue>> = args.get_kw_arg_opt("edgeRefs", &RuntimeType::any_array(), exec_state)?;
    
    if let Some(edge_refs) = edge_refs {
        // New API: use edgeRefs
        let value = inner_fillet_with_edge_refs(solid, radius, edge_refs, tolerance, tag, exec_state, args).await?;
        Ok(KclValue::Solid { value })
    } else {
        // Old API: use tags (backward compatibility)
        let tags_result = args.kw_arg_edge_array_and_source("tags");
        match tags_result {
            Ok(tags) => {
                validate_unique(&tags)?;
                let tags: Vec<EdgeReference> = tags.into_iter().map(|item| item.0).collect();
                let value = inner_fillet(solid, radius, tags, tolerance, tag, exec_state, args).await?;
                Ok(KclValue::Solid { value })
            }
            Err(_) => {
                Err(KclError::new_semantic(KclErrorDetails {
                    source_ranges: vec![args.source_range],
                    message: "You must provide either 'tags' or 'edgeRefs' to fillet edges".to_owned(),
                    backtrace: Default::default(),
                }))
            }
        }
    }
}

async fn inner_fillet(
    solid: Box<Solid>,
    radius: TyF64,
    tags: Vec<EdgeReference>,
    tolerance: Option<TyF64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    // If you try and tag multiple edges with a tagged fillet, we want to return an
    // error to the user that they can only tag one edge at a time.
    if tag.is_some() && tags.len() > 1 {
        return Err(KclError::new_type(KclErrorDetails {
            message: "You can only tag one edge at a time with a tagged fillet. Either delete the tag for the fillet fn if you don't need it OR separate into individual fillet functions for each tag.".to_string(),
            source_ranges: vec![args.source_range],
            backtrace: Default::default(),
        }));
    }
    if tags.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: "You must fillet at least one tag".to_owned(),
            backtrace: Default::default(),
        }));
    }

    let mut solid = solid.clone();
    let edge_ids = tags
        .into_iter()
        .map(|edge_tag| edge_tag.get_engine_id(exec_state, &args))
        .collect::<Result<Vec<_>, _>>()?;

    let id = exec_state.next_uuid();
    let mut extra_face_ids = Vec::new();
    let num_extra_ids = edge_ids.len() - 1;
    for _ in 0..num_extra_ids {
        extra_face_ids.push(exec_state.next_uuid());
    }
    exec_state
        .batch_end_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(
                mcmd::Solid3dFilletEdge::builder()
                    .edge_ids(edge_ids.clone())
                    .extra_face_ids(extra_face_ids)
                    .strategy(Default::default())
                    .object_id(solid.id)
                    .radius(LengthUnit(radius.to_mm()))
                    .tolerance(LengthUnit(
                        tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                    ))
                    .cut_type(CutType::Fillet)
                    .build(),
            ),
        )
        .await?;

    let new_edge_cuts = edge_ids.into_iter().map(|edge_id| EdgeCut::Fillet {
        id,
        edge_id,
        radius: radius.clone(),
        tag: Box::new(tag.clone()),
    });
    solid.edge_cuts.extend(new_edge_cuts);

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

    Ok(solid)
}

/// Helper to resolve a KclValue (tag or UUID) to a face UUID.
/// Tags should refer to faces. If a tag refers to an edge, this will return an error
/// with a helpful message suggesting to use face tags instead.
async fn resolve_face_id(
    value: &KclValue,
    _solid_id: uuid::Uuid,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<uuid::Uuid, KclError> {
    match value {
        KclValue::TagIdentifier(tag) => {
            // Try to get face ID using get_adjacent_face_to_tag (for face tags)
            match args.get_adjacent_face_to_tag(exec_state, tag, false).await {
                Ok(face_id) => Ok(face_id),
                Err(_) => {
                    // The tag doesn't refer to a face. It might refer to an edge.
                    // Provide a helpful error message.
                    let engine_info = args.get_tag_engine_info(exec_state, tag)?;
                    Err(KclError::new_type(KclErrorDetails {
                        message: format!(
                            "Tag `{}` does not refer to a face. For edgeRefs, the 'faces' array must contain tags that refer to faces, not edges. \
                            If you tagged a sketch segment (line/arc), that tag refers to an edge after extrusion. \
                            You need to use face tags instead. Consider using the 'start' or 'end' face, or tag a face directly.",
                            tag.value
                        ),
                        source_ranges: vec![args.source_range],
                        backtrace: Default::default(),
                    }))
                }
            }
        }
        KclValue::Uuid { value: uuid, .. } => Ok(*uuid),
        _ => Err(KclError::new_type(KclErrorDetails {
            message: "EdgeRef faces and disambiguators must be tags or UUIDs".to_string(),
            source_ranges: vec![args.source_range],
            backtrace: Default::default(),
        })),
    }
}

async fn inner_fillet_with_edge_refs(
    solid: Box<Solid>,
    radius: TyF64,
    edge_refs: Vec<KclValue>,
    tolerance: Option<TyF64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    if edge_refs.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: "You must provide at least one edgeRef".to_owned(),
            backtrace: Default::default(),
        }));
    }

    if tag.is_some() && edge_refs.len() > 1 {
        return Err(KclError::new_type(KclErrorDetails {
            message: "You can only tag one edge at a time with a tagged fillet. Either delete the tag for the fillet fn if you don't need it OR separate into individual fillet functions for each edgeRef.".to_string(),
            source_ranges: vec![args.source_range],
            backtrace: Default::default(),
        }));
    }

    let mut solid = solid.clone();
    
    // Parse edgeRefs and resolve tags to UUIDs
    let mut edge_references = Vec::new();
    for edge_ref_value in edge_refs {
        // Parse the edgeRef object
        let edge_ref_obj = match edge_ref_value {
            KclValue::Object { value, .. } => value,
            _ => {
                return Err(KclError::new_type(KclErrorDetails {
                    message: "edgeRefs must be an array of objects with 'faces' field".to_string(),
                    source_ranges: vec![args.source_range],
                    backtrace: Default::default(),
                }));
            }
        };
        
        // Get faces array
        let faces_value = edge_ref_obj.get("faces").ok_or_else(|| {
            KclError::new_type(KclErrorDetails {
                message: "edgeRef must have 'faces' field".to_string(),
                source_ranges: vec![args.source_range],
                backtrace: Default::default(),
            })
        })?;
        
        let faces_array = match faces_value {
            KclValue::HomArray { value, .. } | KclValue::Tuple { value, .. } => value,
            _ => {
                return Err(KclError::new_type(KclErrorDetails {
                    message: "edgeRef 'faces' must be an array".to_string(),
                    source_ranges: vec![args.source_range],
                    backtrace: Default::default(),
                }));
            }
        };
        
        if faces_array.is_empty() {
            return Err(KclError::new_type(KclErrorDetails {
                message: "edgeRef 'faces' must have at least one face".to_string(),
                source_ranges: vec![args.source_range],
                backtrace: Default::default(),
            }));
        }
        
        // Resolve faces to UUIDs
        let mut face_uuids = Vec::new();
        for face_value in faces_array {
            face_uuids.push(resolve_face_id(&face_value, solid.id, exec_state, &args).await?);
        }
        
        // Get disambiguators (optional)
        let mut disambiguator_uuids = Vec::new();
        if let Some(disambiguators_value) = edge_ref_obj.get("disambiguators") {
            let disambiguators_array = match disambiguators_value {
                KclValue::HomArray { value, .. } | KclValue::Tuple { value, .. } => value,
                _ => {
                    return Err(KclError::new_type(KclErrorDetails {
                        message: "edgeRef 'disambiguators' must be an array".to_string(),
                        source_ranges: vec![args.source_range],
                        backtrace: Default::default(),
                    }));
                }
            };
            for disambiguator_value in disambiguators_array {
                disambiguator_uuids.push(resolve_face_id(&disambiguator_value, solid.id, exec_state, &args).await?);
            }
        }
        
        // Get index (optional)
        let index = match edge_ref_obj.get("index") {
            Some(KclValue::Number { value, .. }) => Some(*value as u32),
            Some(_) => {
                return Err(KclError::new_type(KclErrorDetails {
                    message: "edgeRef 'index' must be a number".to_string(),
                    source_ranges: vec![args.source_range],
                    backtrace: Default::default(),
                }));
            }
            None => None, // Not provided - will fillet all matching edges
        };
        
        // Use the EdgeReference from shared module
        // Note: This requires the updated modeling-api with the new EdgeReference struct
        // If compilation fails here, make sure modeling-api is rebuilt
        // Use the EdgeReference from shared module with builder pattern
        use kcmc::shared::EdgeReference;
        // Build EdgeReference - only set index if it was explicitly provided
        // The builder will use None as default if we don't call .index()
        let builder = EdgeReference::builder()
            .faces(face_uuids)
            .disambiguators(disambiguator_uuids);
        
        let edge_ref = if let Some(index_val) = index {
            builder.index(index_val).build()
        } else {
            builder.build()
        };
        
        edge_references.push(edge_ref);
    }

    let id = exec_state.next_uuid();
    let mut extra_face_ids = Vec::new();
    let num_extra_ids = edge_references.len() - 1;
    for _ in 0..num_extra_ids {
        extra_face_ids.push(exec_state.next_uuid());
    }
    
    // Use Solid3dCutEdgeReferences if available, otherwise fall back to Solid3dCutEdges
    // This requires the updated modeling-api
    exec_state
        .batch_end_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(
                mcmd::Solid3dCutEdgeReferences {
                    object_id: solid.id,
                    edges_references: edge_references.clone(),
                    cut_type: CutTypeV2::Fillet {
                        radius: LengthUnit(radius.to_mm()),
                        second_length: None,
                    },
                    tolerance: LengthUnit(
                        tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                    ),
                    strategy: Default::default(),
                    extra_face_ids,
                },
            ),
        )
        .await?;

    // For now, we don't track edge cuts the same way with the new API
    // This might need to be updated based on how the engine returns edge IDs
    // For compatibility, we'll still add the fillet surface if tagged
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
