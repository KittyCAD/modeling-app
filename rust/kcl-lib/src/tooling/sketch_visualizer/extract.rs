//! Extraction from frontend scene objects into visualization inputs.
//!
//! This is the only module that knows how to interpret `front::Segment` values.
//! It records primary geometry for the sidecar, samples curves into polylines for
//! rendering, and preserves enough IDs to let later modules build graph facts.

use std::collections::BTreeMap;
use std::collections::BTreeSet;

use super::connectivity::coincident_groups;
use super::connectivity::connected_components;
use super::connectivity::contact_groups;
use super::connectivity::point_group_index;
use super::constraints::constraint_kind_name;
use super::constraints::constraint_targets;
use super::mode::ModeBehavior;
use super::mode::ModeSidecarContext;
use super::model::InternalPoint;
use super::model::InternalPolyline;
use super::model::InternalSegment;
use super::render::render_png;
use super::sampling::ARC_SAMPLE_COUNT;
use super::sampling::BoundsBuilder;
use super::sampling::distance;
use super::sampling::sample_arc;
use super::sampling::sample_circle;
use super::sampling::sample_control_point_spline;
use super::scene::collect_units;
use super::scene::non_empty_name;
use super::scene::object_by_id;
use super::scene::object_kind_name;
use super::scene::position_to_point;
use super::types::SketchVisualization;
use super::types::SketchVisualizationBounds;
use super::types::SketchVisualizationConstraintData;
use super::types::SketchVisualizationData;
use super::types::SketchVisualizationError;
use super::types::SketchVisualizationOptions;
use super::types::SketchVisualizationPoint;
use super::types::SketchVisualizationPointData;
use super::types::SketchVisualizationPointGroup;
use super::types::SketchVisualizationSegmentData;
use super::types::SketchVisualizationSegmentKind;
use super::types::SketchVisualizationSketchInfo;
use crate::front::ArcDirection;
use crate::front::Freedom;
use crate::front::Object;
use crate::front::ObjectId;
use crate::front::ObjectKind;
use crate::front::Segment;

/// Mutable extraction state for one selected sketch.
///
/// Points are collected before most segment geometry is usable because frontend
/// segments refer to point objects by ID. Missing referenced objects become
/// warnings where possible so the caller still gets a partial diagnostic image.
#[derive(Debug)]
pub(super) struct Extraction<'a> {
    scene_objects: &'a [Object],
    sketch_object: &'a Object,
    options: SketchVisualizationOptions,
    selected_name: Option<String>,
    points: BTreeMap<usize, InternalPoint>,
    primary_segments: BTreeMap<usize, InternalSegment>,
    control_polygons: Vec<InternalPolyline>,
    constraints: Vec<SketchVisualizationConstraintData>,
    units: BTreeSet<String>,
    warnings: Vec<String>,
}

impl<'a> Extraction<'a> {
    pub(super) fn new(
        scene_objects: &'a [Object],
        sketch_object: &'a Object,
        options: SketchVisualizationOptions,
        selected_name: Option<String>,
    ) -> Self {
        Self {
            scene_objects,
            sketch_object,
            options,
            selected_name,
            points: BTreeMap::new(),
            primary_segments: BTreeMap::new(),
            control_polygons: Vec::new(),
            constraints: Vec::new(),
            units: BTreeSet::new(),
            warnings: Vec::new(),
        }
    }

    pub(super) fn collect_points_and_segments(
        &mut self,
        sketch: &crate::front::Sketch,
    ) -> Result<(), SketchVisualizationError> {
        for &object_id in &sketch.segments {
            let object = object_by_id(self.scene_objects, object_id)?;
            let ObjectKind::Segment { segment } = &object.kind else {
                self.warnings.push(format!(
                    "Sketch references object {}, but it is {} instead of a segment",
                    object.id.0,
                    object_kind_name(&object.kind)
                ));
                continue;
            };

            match segment {
                Segment::Point(point) => {
                    self.insert_point(object.id, point)?;
                    // Standalone points are primary geometry. Points owned by a
                    // line, arc, circle, or spline are represented through their
                    // owner segment instead.
                    if point.owner.is_none() {
                        self.primary_segments.insert(
                            object.id.0,
                            InternalSegment {
                                id: object.id.0,
                                kind: SketchVisualizationSegmentKind::Point,
                                point_ids: vec![object.id.0],
                                endpoint_ids: vec![object.id.0],
                                construction: false,
                                freedom: Some(point.freedom()),
                                polylines: vec![vec![position_to_point(&point.position)]],
                            },
                        );
                    }
                }
                Segment::Line(line) => {
                    if line.owner.is_some() {
                        // Owned lines are helper geometry. Today these are the
                        // control polygon edges for splines, and are only drawn
                        // when `show_control_polygons` is enabled.
                        if let Some(polyline) = self.line_polyline(line) {
                            self.control_polygons.push(InternalPolyline {
                                points: polyline,
                                dashed: true,
                            });
                        }
                        continue;
                    }

                    let Some(polyline) = self.line_polyline(line) else {
                        self.warnings.push(format!(
                            "Line segment {} has missing endpoint point objects",
                            object.id.0
                        ));
                        continue;
                    };
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            id: object.id.0,
                            kind: SketchVisualizationSegmentKind::Line,
                            point_ids: vec![line.start.0, line.end.0],
                            endpoint_ids: vec![line.start.0, line.end.0],
                            construction: line.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
                Segment::Arc(arc) => {
                    let Some(polyline) = self.arc_polyline(arc.start, arc.end, arc.center, arc.direction) else {
                        self.warnings
                            .push(format!("Arc segment {} has missing point objects", object.id.0));
                        continue;
                    };
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            id: object.id.0,
                            kind: SketchVisualizationSegmentKind::Arc,
                            point_ids: vec![arc.start.0, arc.end.0, arc.center.0],
                            endpoint_ids: vec![arc.start.0, arc.end.0],
                            construction: arc.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
                Segment::Circle(circle) => {
                    let Some(polyline) = self.circle_polyline(circle.start, circle.center) else {
                        self.warnings
                            .push(format!("Circle segment {} has missing point objects", object.id.0));
                        continue;
                    };
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            id: object.id.0,
                            kind: SketchVisualizationSegmentKind::Circle,
                            point_ids: vec![circle.start.0, circle.center.0],
                            endpoint_ids: Vec::new(),
                            construction: circle.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
                Segment::ControlPointSpline(spline) => {
                    let control_points = spline
                        .controls
                        .iter()
                        .filter_map(|id| self.points.get(&id.0).map(|point| point.position))
                        .collect::<Vec<_>>();
                    if control_points.len() != spline.controls.len() {
                        self.warnings.push(format!(
                            "Control point spline segment {} has missing control point objects",
                            object.id.0
                        ));
                        continue;
                    }
                    let polyline = sample_control_point_spline(&control_points, spline.degree as usize);
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            id: object.id.0,
                            kind: SketchVisualizationSegmentKind::ControlPointSpline,
                            point_ids: spline.controls.iter().map(|id| id.0).collect(),
                            endpoint_ids: spline
                                .controls
                                .first()
                                .into_iter()
                                .chain(spline.controls.last())
                                .map(|id| id.0)
                                .collect(),
                            construction: spline.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
            }
        }

        Ok(())
    }

    pub(super) fn collect_constraints(
        &mut self,
        sketch: &crate::front::Sketch,
    ) -> Result<(), SketchVisualizationError> {
        for &constraint_id in &sketch.constraints {
            let object = object_by_id(self.scene_objects, constraint_id)?;
            let ObjectKind::Constraint { constraint } = &object.kind else {
                self.warnings.push(format!(
                    "Sketch references object {} as a constraint, but it is {}",
                    object.id.0,
                    object_kind_name(&object.kind)
                ));
                continue;
            };
            self.constraints.push(SketchVisualizationConstraintData {
                id: object.id.0,
                kind: constraint_kind_name(constraint).to_owned(),
                targets: constraint_targets(constraint),
            });
        }
        Ok(())
    }

    pub(super) fn finish(self) -> Result<SketchVisualization, SketchVisualizationError> {
        let mode = self.options.mode;
        let contact_groups = contact_groups(&self.points, self.options.contact_tolerance);
        let coincident_groups = coincident_groups(&self.constraints, &self.points);
        let component_result = connected_components(&self.primary_segments, &contact_groups, &coincident_groups);

        let point_contact_group = point_group_index(&contact_groups);
        let point_coincident_group = point_group_index(
            &coincident_groups
                .iter()
                .map(|group| SketchVisualizationPointGroup {
                    id: group.id,
                    point_ids: group.point_ids.clone(),
                })
                .collect::<Vec<_>>(),
        );

        // Build all machine-readable sidecar facts before rendering. The PNG and
        // JSON must agree on colors and bounds, so both are derived from the same
        // internal point/segment maps in this finalization step.
        let rendered_colors = mode.rendered_colors(&self.primary_segments, self.options.theme);
        let mut segment_data = Vec::with_capacity(self.primary_segments.len());
        for segment in self.primary_segments.values() {
            segment_data.push(SketchVisualizationSegmentData {
                id: segment.id,
                kind: segment.kind,
                point_ids: segment.point_ids.clone(),
                endpoint_ids: segment.endpoint_ids.clone(),
                construction: segment.construction,
                component_id: mode.segment_component_id(segment.id, &component_result),
                rendered_color: mode.segment_rendered_color(segment.id, &rendered_colors),
            });
        }

        let mut point_data = Vec::with_capacity(self.points.len());
        for point in self.points.values() {
            point_data.push(SketchVisualizationPointData {
                id: point.id,
                position: point.position,
                owner: point.owner,
                contact_group: mode.point_contact_group(point.id, &point_contact_group),
                coincident_group: mode.point_coincident_group(point.id, &point_coincident_group),
            });
        }

        let bounds = self.bounds();
        let mut data = SketchVisualizationData {
            sketch: SketchVisualizationSketchInfo {
                id: self.sketch_object.id.0,
                name: non_empty_name(&self.sketch_object.label).or(self.selected_name),
            },
            bounds,
            units: self.units.iter().cloned().collect(),
            mode,
            constraint_status: None,
            dof: None,
            points: point_data,
            segments: segment_data,
            constraints: self.constraints.clone(),
            contact_groups: None,
            coincident_groups: None,
            connected_components: None,
            open_endpoints: None,
            closedness_hints: None,
            warnings: self.warnings.clone(),
        };
        mode.attach_sidecar(
            &mut data,
            ModeSidecarContext {
                scene_objects: self.scene_objects,
                sketch_object: self.sketch_object,
                points: &self.points,
                segments: &self.primary_segments,
                contact_groups: &contact_groups,
                coincident_groups: &coincident_groups,
                component_result: &component_result,
            },
        );

        let png = render_png(
            &self.primary_segments,
            &self.control_polygons,
            &self.points,
            &rendered_colors,
            &point_contact_group,
            bounds,
            &self.options,
        )?;

        Ok(SketchVisualization { png, data })
    }

    fn insert_point(&mut self, id: ObjectId, point: &crate::front::Point) -> Result<(), SketchVisualizationError> {
        collect_units(&mut self.units, &point.position);
        self.points.insert(
            id.0,
            InternalPoint {
                id: id.0,
                position: position_to_point(&point.position),
                owner: point.owner.map(|owner| owner.0),
                freedom: point.freedom(),
            },
        );
        Ok(())
    }

    fn point_freedom(&self, id: ObjectId) -> Option<Freedom> {
        self.points.get(&id.0).map(|point| point.freedom)
    }

    fn line_polyline(&self, line: &crate::front::Line) -> Option<Vec<SketchVisualizationPoint>> {
        Some(vec![
            self.points.get(&line.start.0)?.position,
            self.points.get(&line.end.0)?.position,
        ])
    }

    fn arc_polyline(
        &self,
        start_id: ObjectId,
        end_id: ObjectId,
        center_id: ObjectId,
        direction: ArcDirection,
    ) -> Option<Vec<SketchVisualizationPoint>> {
        let start = self.points.get(&start_id.0)?.position;
        let end = self.points.get(&end_id.0)?.position;
        let center = self.points.get(&center_id.0)?.position;
        Some(sample_arc(center, start, end, direction.is_ccw(), ARC_SAMPLE_COUNT))
    }

    fn circle_polyline(&self, start_id: ObjectId, center_id: ObjectId) -> Option<Vec<SketchVisualizationPoint>> {
        let start = self.points.get(&start_id.0)?.position;
        let center = self.points.get(&center_id.0)?.position;
        let radius = distance(start, center);
        Some(sample_circle(center, radius, ARC_SAMPLE_COUNT))
    }

    fn bounds(&self) -> SketchVisualizationBounds {
        let mut bounds = BoundsBuilder::default();
        for segment in self.primary_segments.values() {
            for polyline in &segment.polylines {
                for point in polyline {
                    bounds.include(*point);
                }
            }
        }
        for point in self.points.values() {
            bounds.include(point.position);
        }
        bounds.finish()
    }
}
