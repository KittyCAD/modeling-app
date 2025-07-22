//! Standard library fillets.

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::CutType};
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

/// Create fillets on tagged paths.
pub async fn fillet(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let radius: TyF64 = args.get_kw_arg("radius", &RuntimeType::length(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let tags = args.kw_arg_edge_array_and_source("tags")?;
    let tag = args.get_kw_arg_opt("tag", &RuntimeType::tag_decl(), exec_state)?;

    // Run the function.
    validate_unique(&tags)?;
    let tags: Vec<EdgeReference> = tags.into_iter().map(|item| item.0).collect();
    let value = inner_fillet(solid, radius, tags, tolerance, tag, exec_state, args).await?;
    Ok(KclValue::Solid { value })
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
            ModelingCmdMeta::from_args_id(&args, id),
            ModelingCmd::from(mcmd::Solid3dFilletEdge {
                edge_id: None,
                edge_ids: edge_ids.clone(),
                extra_face_ids,
                strategy: Default::default(),
                object_id: solid.id,
                radius: LengthUnit(radius.to_mm()),
                tolerance: LengthUnit(tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM)),
                cut_type: CutType::Fillet,
            }),
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
