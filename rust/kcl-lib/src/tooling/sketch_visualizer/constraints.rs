use crate::front::Constraint;
use crate::front::Horizontal;
use crate::front::ObjectId;
use crate::front::Vertical;
use crate::frontend::sketch::ConstraintSegment;

use super::types::SketchVisualizationConstraintTarget;

pub(super) fn constraint_kind_name(constraint: &Constraint) -> &'static str {
    match constraint {
        Constraint::Coincident(_) => "coincident",
        Constraint::Distance(_) => "distance",
        Constraint::Angle(_) => "angle",
        Constraint::Diameter(_) => "diameter",
        Constraint::EqualRadius(_) => "equal_radius",
        Constraint::Fixed(_) => "fixed",
        Constraint::HorizontalDistance(_) => "horizontal_distance",
        Constraint::VerticalDistance(_) => "vertical_distance",
        Constraint::Horizontal(_) => "horizontal",
        Constraint::LinesEqualLength(_) => "lines_equal_length",
        Constraint::Midpoint(_) => "midpoint",
        Constraint::Parallel(_) => "parallel",
        Constraint::Perpendicular(_) => "perpendicular",
        Constraint::Radius(_) => "radius",
        Constraint::Symmetric(_) => "symmetric",
        Constraint::Tangent(_) => "tangent",
        Constraint::Vertical(_) => "vertical",
    }
}

pub(super) fn constraint_targets(constraint: &Constraint) -> Vec<SketchVisualizationConstraintTarget> {
    match constraint {
        Constraint::Coincident(coincident) => coincident.segments.iter().map(constraint_segment_target).collect(),
        Constraint::Distance(distance)
        | Constraint::HorizontalDistance(distance)
        | Constraint::VerticalDistance(distance) => distance.points.iter().map(constraint_segment_target).collect(),
        Constraint::Angle(angle) => angle.lines.iter().map(|id| object_target(*id)).collect(),
        Constraint::Diameter(diameter) => vec![object_target(diameter.arc)],
        Constraint::EqualRadius(equal_radius) => equal_radius.input.iter().map(|id| object_target(*id)).collect(),
        Constraint::Fixed(fixed) => fixed.points.iter().map(|point| object_target(point.point)).collect(),
        Constraint::Horizontal(horizontal) => match horizontal {
            Horizontal::Line { line } => vec![object_target(*line)],
            Horizontal::Points { points } => points.iter().map(constraint_segment_target).collect(),
        },
        Constraint::LinesEqualLength(equal_length) => equal_length.lines.iter().map(|id| object_target(*id)).collect(),
        Constraint::Midpoint(midpoint) => vec![
            constraint_segment_target(&midpoint.point),
            object_target(midpoint.segment),
        ],
        Constraint::Parallel(parallel) => parallel.lines.iter().map(|id| object_target(*id)).collect(),
        Constraint::Perpendicular(perpendicular) => perpendicular.lines.iter().map(|id| object_target(*id)).collect(),
        Constraint::Radius(radius) => vec![object_target(radius.arc)],
        Constraint::Symmetric(symmetric) => symmetric
            .input
            .iter()
            .chain(std::iter::once(&symmetric.axis))
            .map(|id| object_target(*id))
            .collect(),
        Constraint::Tangent(tangent) => tangent.input.iter().map(|id| object_target(*id)).collect(),
        Constraint::Vertical(vertical) => match vertical {
            Vertical::Line { line } => vec![object_target(*line)],
            Vertical::Points { points } => points.iter().map(constraint_segment_target).collect(),
        },
    }
}

fn constraint_segment_target(segment: &ConstraintSegment) -> SketchVisualizationConstraintTarget {
    match segment {
        ConstraintSegment::Segment(id) => object_target(*id),
        ConstraintSegment::Origin(_) => SketchVisualizationConstraintTarget::Origin,
    }
}

fn object_target(id: ObjectId) -> SketchVisualizationConstraintTarget {
    SketchVisualizationConstraintTarget::Object { id: id.0 }
}
