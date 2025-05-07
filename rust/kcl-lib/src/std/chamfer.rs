//! Standard library chamfers.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::CutType, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc, shared::CutStrategy};

use super::args::TyF64;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{PrimitiveType, RuntimeType},
        ChamferSurface, EdgeCut, ExecState, ExtrudeSurface, GeoMeta, KclValue, Solid,
    },
    parsing::ast::types::TagNode,
    std::{fillet::EdgeReference, Args},
};

pub(crate) const DEFAULT_TOLERANCE: f64 = 0.0000001;

/// Create chamfers on tagged paths.
pub async fn chamfer(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg_typed("solid", &RuntimeType::Primitive(PrimitiveType::Solid), exec_state)?;
    let length: TyF64 = args.get_kw_arg_typed("length", &RuntimeType::length(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt_typed("tolerance", &RuntimeType::length(), exec_state)?;
    let strategy: Option<CutStrategy> = args.get_kw_arg_opt("strategy")?;
    let tags = args.kw_arg_array_and_source::<EdgeReference>("tags")?;
    let tag = args.get_kw_arg_opt("tag")?;

    super::fillet::validate_unique(&tags)?;
    let tags: Vec<EdgeReference> = tags.into_iter().map(|item| item.0).collect();
    let value = inner_chamfer(solid, length, tags, tolerance, strategy, tag, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

#[allow(clippy::too_many_arguments)]
async fn inner_chamfer(
    solid: Box<Solid>,
    length: TyF64,
    tags: Vec<EdgeReference>,
    tolerance: Option<TyF64>,
    strategy: Option<CutStrategy>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    // If you try and tag multiple edges with a tagged chamfer, we want to return an
    // error to the user that they can only tag one edge at a time.
    if tag.is_some() && tags.len() > 1 {
        return Err(KclError::Type(KclErrorDetails {
            message: "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each tag.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }
    if tags.is_empty() {
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: "You must chamfer at least one tag".to_owned(),
        }));
    }
    let mut solid = solid.clone();
    let edge_ids: Vec<_> = tags
        .into_iter()
        .map(|edge_tag| edge_tag.get_engine_id(exec_state, &args))
        .collect::<Result<Vec<_>, _>>()?;

    let id = exec_state.next_uuid();
    let mut extra_face_ids = Vec::new();
    let num_extra_ids = edge_ids.len() - 1;
    for _ in 0..num_extra_ids {
        extra_face_ids.push(exec_state.next_uuid());
    }
    let strategy = strategy.unwrap_or_default();
    args.batch_end_cmd(
        id,
        ModelingCmd::from(mcmd::Solid3dFilletEdge {
            edge_id: None,
            edge_ids: edge_ids.clone(),
            extra_face_ids: extra_face_ids.clone(),
            strategy,
            object_id: solid.id,
            radius: LengthUnit(length.to_mm()),
            tolerance: LengthUnit(tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE)),
            cut_type: CutType::Chamfer,
        }),
    )
    .await?;
    for edge_id in edge_ids {
        solid.edge_cuts.push(EdgeCut::Chamfer {
            id,
            edge_id,
            length: length.clone(),
            tag: Box::new(tag.clone()),
        });
    }

    if let Some(ref tag) = tag {
        solid.value.push(ExtrudeSurface::Chamfer(ChamferSurface {
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
