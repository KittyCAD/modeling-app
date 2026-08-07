//! Mode-specific rendering and sidecar behavior.
//!
//! Extraction builds the common sketch facts once: points, primary segments,
//! constraints, contact groups, and connected components. The selected mode then
//! decides how to color those facts and which explanatory sidecar block belongs
//! in the JSON payload.

use std::collections::BTreeMap;

use super::model::ComponentResult;
use super::model::InternalPoint;
use super::model::InternalSegment;
use super::render::FREE_COLOR;
use super::render::dof_color;
use super::render::id_color;
use super::types::SketchVisualizationCoincidentGroup;
use super::types::SketchVisualizationData;
use super::types::SketchVisualizationDofBuckets;
use super::types::SketchVisualizationDofData;
use super::types::SketchVisualizationMode;
use super::types::SketchVisualizationPointGroup;
use super::types::SketchVisualizationTheme;
use crate::execution::sketch_constraint_status_for_sketch;
use crate::front::Freedom;
use crate::front::Object;

/// Shared facts available to mode-specific sidecar builders.
pub(super) struct ModeSidecarContext<'a> {
    pub(super) scene_objects: &'a [Object],
    pub(super) sketch_object: &'a Object,
    pub(super) points: &'a BTreeMap<usize, InternalPoint>,
    pub(super) segments: &'a BTreeMap<usize, InternalSegment>,
    pub(super) id_color_map: &'a BTreeMap<usize, String>,
    pub(super) contact_groups: &'a [SketchVisualizationPointGroup],
    pub(super) coincident_groups: &'a [SketchVisualizationCoincidentGroup],
    pub(super) component_result: &'a ComponentResult,
}

/// Behavior bundled with each serialized visualization mode.
pub(super) trait ModeBehavior {
    fn rendered_colors(
        self,
        segments: &BTreeMap<usize, InternalSegment>,
        id_color_map: &BTreeMap<usize, String>,
        theme: SketchVisualizationTheme,
    ) -> BTreeMap<usize, String>;

    fn segment_rendered_color(self, segment_id: usize, rendered_colors: &BTreeMap<usize, String>) -> Option<String>;

    fn segment_component_id(self, segment_id: usize, component_result: &ComponentResult) -> Option<usize>;

    fn point_contact_group(self, point_id: usize, point_contact_group: &BTreeMap<usize, usize>) -> Option<usize>;

    fn point_coincident_group(self, point_id: usize, point_coincident_group: &BTreeMap<usize, usize>) -> Option<usize>;

    fn attach_sidecar(self, data: &mut SketchVisualizationData, context: ModeSidecarContext<'_>);
}

impl ModeBehavior for SketchVisualizationMode {
    fn rendered_colors(
        self,
        segments: &BTreeMap<usize, InternalSegment>,
        id_color_map: &BTreeMap<usize, String>,
        theme: SketchVisualizationTheme,
    ) -> BTreeMap<usize, String> {
        segments
            .values()
            .map(|segment| {
                let color = match self {
                    SketchVisualizationMode::Ids => id_color_map
                        .get(&segment.id)
                        .cloned()
                        .unwrap_or_else(|| id_color(segment.id).to_hex_string()),
                    SketchVisualizationMode::Dof => dof_color(segment.freedom, theme).to_hex_string(),
                };
                (segment.id, color)
            })
            .collect()
    }

    fn segment_rendered_color(self, segment_id: usize, rendered_colors: &BTreeMap<usize, String>) -> Option<String> {
        match self {
            SketchVisualizationMode::Dof => Some(
                rendered_colors
                    .get(&segment_id)
                    .cloned()
                    .unwrap_or_else(|| FREE_COLOR.to_hex_string()),
            ),
            SketchVisualizationMode::Ids => None,
        }
    }

    fn segment_component_id(self, segment_id: usize, component_result: &ComponentResult) -> Option<usize> {
        match self {
            SketchVisualizationMode::Dof => Some(
                component_result
                    .segment_to_component
                    .get(&segment_id)
                    .copied()
                    .unwrap_or_default(),
            ),
            SketchVisualizationMode::Ids => None,
        }
    }

    fn point_contact_group(self, point_id: usize, point_contact_group: &BTreeMap<usize, usize>) -> Option<usize> {
        match self {
            SketchVisualizationMode::Dof => point_contact_group.get(&point_id).copied(),
            SketchVisualizationMode::Ids => None,
        }
    }

    fn point_coincident_group(self, point_id: usize, point_coincident_group: &BTreeMap<usize, usize>) -> Option<usize> {
        match self {
            SketchVisualizationMode::Dof => point_coincident_group.get(&point_id).copied(),
            SketchVisualizationMode::Ids => None,
        }
    }

    fn attach_sidecar(self, data: &mut SketchVisualizationData, context: ModeSidecarContext<'_>) {
        match self {
            SketchVisualizationMode::Dof => attach_dof_sidecar(data, context),
            SketchVisualizationMode::Ids => {
                data.id_color_map = Some(context.id_color_map.clone());
            }
        }
    }
}

fn attach_dof_sidecar(data: &mut SketchVisualizationData, context: ModeSidecarContext<'_>) {
    data.constraint_status = sketch_constraint_status_for_sketch(context.scene_objects, context.sketch_object);
    data.dof = Some(dof_data(context.points, context.segments));
    data.contact_groups = Some(context.contact_groups.to_vec());
    data.coincident_groups = Some(context.coincident_groups.to_vec());
    data.connected_components = Some(context.component_result.components.clone());
    data.open_endpoints = Some(context.component_result.open_endpoints.clone());
    data.closedness_hints = Some(context.component_result.closedness_hints.clone());
}

fn dof_data(
    points: &BTreeMap<usize, InternalPoint>,
    segments: &BTreeMap<usize, InternalSegment>,
) -> SketchVisualizationDofData {
    let mut point_buckets = SketchVisualizationDofBuckets::default();
    for point in points.values() {
        point_buckets.insert(point.id, Some(point.freedom));
    }

    let mut segment_buckets = SketchVisualizationDofBuckets::default();
    for segment in segments.values() {
        segment_buckets.insert(segment.id, segment.freedom);
    }

    SketchVisualizationDofData {
        default_state: Freedom::Free,
        points: point_buckets,
        segments: segment_buckets,
    }
}
