//! Extraction from frontend scene objects into rasterization inputs.

use std::collections::BTreeMap;
use std::collections::BTreeSet;

use super::model::InternalPoint;
use super::model::InternalSegment;
use super::render::render_png;
use super::sampling::ARC_SAMPLE_COUNT;
use super::sampling::BoundsBuilder;
use super::sampling::distance;
use super::sampling::sample_arc;
use super::sampling::sample_circle;
use super::sampling::sample_control_point_spline;
use super::scene::object_by_id;
use super::scene::position_to_point;
use super::types::CONTACT_TOLERANCE;
use super::types::SketchVisualizationBounds;
use super::types::SketchVisualizationError;
use super::types::SketchVisualizationOptions;
use super::types::SketchVisualizationPoint;
use super::types::SketchVisualizationSegmentKind;
use crate::front::ArcDirection;
use crate::front::Freedom;
use crate::front::Object;
use crate::front::ObjectId;
use crate::front::ObjectKind;
use crate::front::Segment;

#[derive(Debug)]
pub(super) struct Extraction<'a> {
    scene_objects: &'a [Object],
    options: SketchVisualizationOptions,
    points: BTreeMap<usize, InternalPoint>,
    primary_segments: BTreeMap<usize, InternalSegment>,
}

impl<'a> Extraction<'a> {
    pub(super) fn new(scene_objects: &'a [Object], options: SketchVisualizationOptions) -> Self {
        Self {
            scene_objects,
            options,
            points: BTreeMap::new(),
            primary_segments: BTreeMap::new(),
        }
    }

    pub(super) fn collect_points_and_segments(
        &mut self,
        sketch: &crate::front::Sketch,
    ) -> Result<(), SketchVisualizationError> {
        for &object_id in &sketch.segments {
            let object = object_by_id(self.scene_objects, object_id)?;
            let ObjectKind::Segment { segment } = &object.kind else {
                continue;
            };

            match segment {
                Segment::Point(point) => {
                    self.insert_point(object.id, point);
                    if point.owner.is_none() {
                        self.primary_segments.insert(
                            object.id.0,
                            InternalSegment {
                                kind: SketchVisualizationSegmentKind::Point,
                                construction: false,
                                freedom: Some(point.freedom()),
                                polylines: vec![vec![position_to_point(&point.position)]],
                            },
                        );
                    }
                }
                Segment::Line(line) => {
                    if line.owner.is_some() {
                        continue;
                    }

                    let Some(polyline) = self.line_polyline(line) else {
                        continue;
                    };
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            kind: SketchVisualizationSegmentKind::Line,
                            construction: line.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
                Segment::Arc(arc) => {
                    let Some(polyline) = self.arc_polyline(arc.start, arc.end, arc.center, arc.direction) else {
                        continue;
                    };
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            kind: SketchVisualizationSegmentKind::Arc,
                            construction: arc.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![polyline],
                        },
                    );
                }
                Segment::Circle(circle) => {
                    let Some(polyline) = self.circle_polyline(circle.start, circle.center) else {
                        continue;
                    };
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            kind: SketchVisualizationSegmentKind::Circle,
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
                        continue;
                    }
                    self.primary_segments.insert(
                        object.id.0,
                        InternalSegment {
                            kind: SketchVisualizationSegmentKind::ControlPointSpline,
                            construction: spline.construction,
                            freedom: segment.freedom(|id| self.point_freedom(id)),
                            polylines: vec![sample_control_point_spline(&control_points, spline.degree as usize)],
                        },
                    );
                }
            }
        }

        Ok(())
    }

    pub(super) fn finish(self) -> Result<Vec<u8>, SketchVisualizationError> {
        let bounds = self.bounds();
        let contact_point_ids = self.contact_point_ids();
        render_png(
            &self.primary_segments,
            &self.points,
            &contact_point_ids,
            bounds,
            &self.options,
        )
    }

    fn insert_point(&mut self, id: ObjectId, point: &crate::front::Point) {
        self.points.insert(
            id.0,
            InternalPoint {
                position: position_to_point(&point.position),
                owner: point.owner.map(|owner| owner.0),
                freedom: point.freedom(),
            },
        );
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
        Some(sample_circle(center, distance(start, center), ARC_SAMPLE_COUNT))
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

    fn contact_point_ids(&self) -> BTreeSet<usize> {
        let mut contact_point_ids = BTreeSet::new();
        let points = self.points.iter().collect::<Vec<_>>();
        for (index, (left_id, left)) in points.iter().enumerate() {
            for (right_id, right) in points.iter().skip(index + 1) {
                if distance(left.position, right.position) <= CONTACT_TOLERANCE {
                    contact_point_ids.insert(**left_id);
                    contact_point_ids.insert(**right_id);
                }
            }
        }
        contact_point_ids
    }
}
