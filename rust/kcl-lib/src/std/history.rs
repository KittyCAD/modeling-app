//! Experimental extrusion history for resolving faces on a current body.

use std::collections::HashSet;

use kittycad_modeling_cmds::each_cmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::BooleanTopologyReassignment;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use uuid::Uuid;

use crate::ExecState;
use crate::ExecutorContext;
use crate::KclError;
use crate::SourceRange;
use crate::errors::KclErrorDetails;
use crate::execution::ExtrudeSurface;
use crate::execution::FaceParentSolid;
use crate::execution::KclValue;
use crate::execution::Metadata;
use crate::execution::ModelingCmdMeta;
use crate::execution::Point3d;
use crate::execution::Solid;
use crate::execution::kcl_value::KclObjectFields;
use crate::execution::kcl_value::KclObjectKind;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ExtrusionHistory {
    occurrence: Uuid,
    source: SourceRange,
    region_tag: Option<String>,
    walls: Vec<Wall>,
}

#[derive(Debug, Clone, PartialEq)]
struct Wall {
    // Name and location of the boundary source in the producer module.
    name: String,
    source: SourceRange,
    face: Uuid,
    cap: bool,
}

impl ExtrusionHistory {
    pub(crate) fn from_solid(solid: &Solid, source: SourceRange) -> Self {
        let walls = solid
            .value
            .iter()
            .filter(|face| matches!(face, ExtrudeSurface::ExtrudePlane(_) | ExtrudeSurface::ExtrudeArc(_)))
            .filter_map(|face| {
                let tag = face.get_tag()?;
                Some(Wall {
                    name: tag.name.clone(),
                    source: tag.into(),
                    face: face.face_id(),
                    cap: false,
                })
            })
            .chain(
                [("start", solid.start_cap_id), ("end", solid.end_cap_id)]
                    .into_iter()
                    .filter_map(|(name, face)| {
                        Some(Wall {
                            name: name.into(),
                            source,
                            face: face?,
                            cap: true,
                        })
                    }),
            )
            .collect();
        Self {
            occurrence: solid.value_id,
            source,
            region_tag: solid.sketch().and_then(|sketch| sketch.region_history_tag.clone()),
            walls,
        }
    }
}

pub(super) fn inherit_copy_history(copy: &mut Solid, source: &Solid, pairs: &[[Uuid; 2]]) {
    let ids: std::collections::HashMap<_, _> = pairs.iter().map(|[from, to]| (*from, *to)).collect();
    copy.extrusion_history = source.extrusion_history.clone();
    for extrusion in &mut copy.extrusion_history {
        extrusion.walls.retain_mut(|wall| {
            if let Some(id) = ids.get(&wall.face) {
                wall.face = *id;
                true
            } else {
                false
            }
        });
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HistoryExtrusions {
    owner: HistoryOwner,
    entries: Vec<ExtrusionHistory>,
    by_region: bool,
}

impl HistoryExtrusions {
    pub(crate) fn named(&self, name: &str, range: SourceRange) -> Result<KclValue, KclError> {
        if !self.by_region {
            return Err(error("Use a zero-based index for history.extrusions, or an explicit region anchor.", range));
        }
        let mut matches = self.entries.iter().filter(|entry| entry.region_tag.as_deref() == Some(name));
        let Some(entry) = matches.next() else {
            return Err(error(format!("No contributing region anchor named '{name}'."), range));
        };
        if matches.next().is_some() {
            return Err(error(format!("More than one contributing extrusion matches region anchor '{name}'."), range));
        }
        Ok(self.entry(entry, range))
    }

    pub(crate) fn indexed(&self, index: usize, range: SourceRange) -> Result<KclValue, KclError> {
        self.entries
            .get(index)
            .map(|entry| self.entry(entry, range))
            .ok_or_else(|| error(format!("No contributing extrusion at index {index}."), range))
    }

    fn entry(&self, entry: &ExtrusionHistory, range: SourceRange) -> KclValue {
        let members = [
            ("walls", false, false),
            ("wallFaces", false, true),
            ("capFaces", true, true),
        ]
        .into_iter()
        .map(|(key, cap, group)| {
            let value = object(
                Default::default(),
                KclObjectKind::HistoryWalls {
                    value: Box::new(HistoryWalls {
                        owner: self.owner.clone(),
                        walls: entry.walls.iter().filter(|wall| wall.cap == cap).cloned().collect(),
                        group,
                    }),
                },
                range,
            );
            (key.to_owned(), value)
        })
        .collect();
        object(members, KclObjectKind::Default, range)
    }
}

fn occurrences(solid: &Solid) -> Vec<ExtrusionHistory> {
    let mut entries: indexmap::IndexMap<Uuid, ExtrusionHistory> = indexmap::IndexMap::new();
    for extrusion in &solid.extrusion_history {
        if let Some(existing) = entries.get_mut(&extrusion.occurrence) {
            existing.walls.extend(extrusion.walls.iter().cloned());
        } else {
            entries.insert(extrusion.occurrence, extrusion.clone());
        }
    }
    entries.into_values().collect()
}

pub(crate) fn history_references(
    solid: &Solid,
) -> (
    Vec<(Uuid, usize, String)>,
    Vec<(Uuid, usize, String, String)>,
    Vec<(Uuid, String, String, String)>,
    Vec<SourceRange>,
) {
    let entries = occurrences(solid);
    let mut anchor_counts = std::collections::HashMap::new();
    for entry in &entries {
        if let Some(anchor) = &entry.region_tag {
            *anchor_counts.entry(anchor).or_insert(0usize) += 1;
        }
    }
    let mut walls = Vec::new();
    let mut groups = Vec::new();
    let mut anchors = Vec::new();
    let mut sources = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        sources.push(entry.source);
        let mut planar_candidates = indexmap::IndexMap::<_, HashSet<_>>::new();
        for wall in &entry.walls {
            let collection = if wall.cap { "capFaces" } else { "wallFaces" };
            groups.push((wall.face, index, collection.to_owned(), wall.name.clone()));
            if let Some(anchor) = &entry.region_tag
                && anchor_counts.get(anchor) == Some(&1)
            {
                anchors.push((wall.face, anchor.clone(), collection.to_owned(), wall.name.clone()));
            }
            if !wall.cap {
                planar_candidates.entry(&wall.name).or_default().insert(wall.face);
            }
        }
        for (name, ids) in planar_candidates {
            if ids.len() == 1 {
                walls.extend(ids.into_iter().map(|id| (id, index, name.clone())));
            }
        }
    }
    (walls, groups, anchors, sources)
}

pub(super) fn contains_tagged_wall(solid: &Solid, tag: &crate::execution::TagIdentifier) -> bool {
    solid
        .extrusion_history
        .iter()
        .flat_map(|entry| &entry.walls)
        .any(|wall| !wall.cap && wall.name == tag.value && tag.meta.iter().any(|meta| meta.source_range == wall.source))
}

pub(super) fn combine(solids: &[Solid]) -> Vec<ExtrusionHistory> {
    solids
        .iter()
        .flat_map(|solid| solid.extrusion_history.iter().cloned())
        .collect()
}

pub(super) fn after_subtraction(
    target: &Solid,
    tool: &Solid,
    output: Uuid,
    complete: Option<&[BooleanTopologyReassignment]>,
    sparse: &[BooleanTopologyReassignment],
) -> Vec<ExtrusionHistory> {
    target
        .extrusion_history
        .iter()
        .chain(&tool.extrusion_history)
        .cloned()
        .map(|mut extrusion| {
            extrusion.walls = extrusion
                .walls
                .into_iter()
                .flat_map(|wall| {
                    let links = complete.unwrap_or(sparse);
                    if complete.is_none() && !links.iter().any(|link| link.source_id == wall.face) {
                        return vec![wall];
                    }
                    links
                        .iter()
                        .filter(|link| link.source_id == wall.face && link.owner_id == output)
                        .map(|link| Wall {
                            face: link.replacement_id,
                            ..wall.clone()
                        })
                        .collect()
                })
                .collect();
            extrusion
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
struct HistoryOwner {
    parent: FaceParentSolid,
    value_id: Uuid,
    units: kcl_api::UnitLength,
    mock_axes: Option<(Point3d, Point3d)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HistoryWalls {
    owner: HistoryOwner,
    walls: Vec<Wall>,
    group: bool,
}

fn object(fields: KclObjectFields, object_kind: KclObjectKind, source_range: SourceRange) -> KclValue {
    KclValue::Object {
        value: fields,
        object_kind,
        constrainable: false,
        meta: vec![Metadata { source_range }],
    }
}

pub(crate) async fn solid_history(
    solid: &Solid,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
    range: SourceRange,
    anchors_only: bool,
) -> Result<KclValue, KclError> {
    super::solid_consumption::validate_solids_not_consumed(std::slice::from_ref(solid), exec_state, range)?;
    let live = if solid.extrusion_history.is_empty() || ctx.no_engine_commands().await {
        None
    } else {
        let meta = ModelingCmdMeta::new(exec_state, ctx, range);
        exec_state
            .flush_batch_for_solids(meta, std::slice::from_ref(solid))
            .await?;
        let meta = ModelingCmdMeta::new(exec_state, ctx, range);
        let result = exec_state
            .send_modeling_cmd(
                meta,
                each_cmd::EntityGetAllChildUuids::builder()
                    .entity_id(solid.id)
                    .build()
                    .into(),
            )
            .await?;
        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::EntityGetAllChildUuids(children),
        } = result
        else {
            return Err(error("Could not verify the body's live wall faces.", range));
        };
        Some(children.entity_ids.into_iter().collect::<HashSet<_>>())
    };

    let mut occurrences = occurrences(solid);
    if let Some(live) = live {
        for extrusion in &mut occurrences {
            extrusion.walls.retain(|wall| live.contains(&wall.face));
        }
    }

    let owner = HistoryOwner {
        parent: FaceParentSolid::from(solid),
        value_id: solid.value_id,
        units: solid.units,
        mock_axes: solid.sketch().map(|sketch| (sketch.on.x_axis(), sketch.on.y_axis())),
    };
    let collection = |by_region| {
        object(
            Default::default(),
            KclObjectKind::HistoryExtrusions {
                value: Box::new(HistoryExtrusions {
                    owner: owner.clone(),
                    entries: occurrences.clone(),
                    by_region,
                }),
            },
            range,
        )
    };
    if anchors_only {
        return Ok(collection(true));
    }
    let entries = [("extrusions".to_owned(), collection(false)), ("regions".to_owned(), collection(true))]
        .into_iter()
        .collect();
    Ok(object(entries, KclObjectKind::Default, range))
}

pub(crate) async fn wall_face(
    history: &HistoryWalls,
    name: &str,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
    range: SourceRange,
) -> Result<KclValue, KclError> {
    super::solid_consumption::validate_body_not_consumed(
        history.owner.parent.solid_id,
        history.owner.value_id,
        exec_state,
        range,
    )?;
    if history.group {
        let mut faces = history
            .walls
            .iter()
            .filter(|wall| wall.name == name)
            .map(|wall| wall.face)
            .collect::<Vec<_>>();
        faces.sort_unstable();
        faces.dedup();
        if faces.is_empty() {
            return Err(error(
                format!("No live faces named '{name}' on this extrusion and body."),
                range,
            ));
        }
        return Ok(object(
            Default::default(),
            KclObjectKind::HistoryFaceGroup {
                owner: history.owner.parent.solid_id,
                value_id: history.owner.value_id,
                faces,
            },
            range,
        ));
    }
    let mut faces = history.walls.iter().filter(|wall| wall.name == name);
    let Some(wall) = faces.next() else {
        return Err(error(
            format!("No live wall named '{name}' on this extrusion and body."),
            range,
        ));
    };
    if faces.any(|other| other.face != wall.face) {
        return Err(error(
            format!("Wall '{name}' resolves to multiple faces on this body."),
            range,
        ));
    }

    let axes = if ctx.no_engine_commands().await {
        history
            .owner
            .mock_axes
            .clone()
            .ok_or_else(|| error("Wall axes are unavailable.", range))?
    } else {
        super::faces::query_planar_axes(wall.face, exec_state, ctx, range).await?
    };
    Ok(KclValue::Face {
        value: super::faces::register_face(
            history.owner.parent.clone(),
            history.owner.units,
            wall.face,
            name.to_owned(),
            axes.0,
            axes.1,
            exec_state,
            range,
            None,
        ),
    })
}

fn error(message: impl Into<String>, range: SourceRange) -> KclError {
    KclError::new_semantic(KclErrorDetails::new(message.into(), vec![range]))
}
