//! Standard library chamfers.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::CutType};
use kittycad_modeling_cmds as kcmc;

use super::args::TyF64;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ChamferSurface, EdgeCut, ExecState, ExtrudeSurface, GeoMeta, KclValue, ModelingCmdMeta, Solid,
        types::RuntimeType,
    },
    parsing::ast::types::TagNode,
    std::{Args, fillet::EdgeReference},
};

pub(crate) const DEFAULT_TOLERANCE: f64 = 0.0000001;

/// Create chamfers on tagged paths.
pub async fn chamfer(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let length: TyF64 = args.get_kw_arg("length", &RuntimeType::length(), exec_state)?;
    let tags = args.kw_arg_edge_array_and_source("tags")?;
    let tag = args.get_kw_arg_opt("tag", &RuntimeType::tag_decl(), exec_state)?;

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
        return Err(KclError::new_type(KclErrorDetails::new(
            "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each tag.".to_string(),
            vec![args.source_range],
        )));
    }

    let mut solid = solid.clone();
    for edge_tag in tags {
        let edge_id = match edge_tag {
            EdgeReference::Uuid(uuid) => uuid,
            EdgeReference::Tag(edge_tag) => args.get_tag_engine_info(exec_state, &edge_tag)?.id,
        };

        let id = exec_state.next_uuid();
        exec_state
            .batch_end_cmd(
                ModelingCmdMeta::from_args_id(&args, id),
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
