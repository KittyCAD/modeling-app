//! Standard library chamfers.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::CutType, ModelingCmd};
use kittycad_modeling_cmds as kcmc;

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
    let tags = args.kw_arg_array_and_source::<EdgeReference>("tags")?;
    let tag = args.get_kw_arg_opt("tag")?;

    super::fillet::validate_unique(&tags)?;
    let tags: Vec<EdgeReference> = tags.into_iter().map(|item| item.0).collect();
    let value = inner_chamfer(solid, length, tags, tag, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

async fn inner_chamfer(
    solid: Box<Solid>,
    length: TyF64,
    tags: Vec<EdgeReference>,
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

    let mut solid = solid.clone();
    for edge_tag in tags {
        let edge_id = match edge_tag {
            EdgeReference::Uuid(uuid) => uuid,
            EdgeReference::Tag(edge_tag) => args.get_tag_engine_info(exec_state, &edge_tag)?.id,
        };

        let id = exec_state.next_uuid();
        args.batch_end_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dFilletEdge {
                edge_id: None,
                edge_ids: vec![edge_id],
                extra_face_ids: vec![],
                strategy: Default::default(),
                object_id: solid.id,
                radius: LengthUnit(length.to_mm()),
                tolerance: LengthUnit(DEFAULT_TOLERANCE), // We can let the user set this in the future.
                cut_type: CutType::Chamfer,
            }),
        )
        .await?;

        solid.edge_cuts.push(EdgeCut::Chamfer {
            id,
            edge_id,
            length: length.clone(),
            tag: Box::new(tag.clone()),
        });

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
    }

    Ok(solid)
}
