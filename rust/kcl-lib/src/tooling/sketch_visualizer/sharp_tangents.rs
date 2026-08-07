//! Detection for tangent constraints that look visually sharp.
//!
//! A tangent constraint can be mathematically satisfied while the arc travels the
//! long way around, producing a cusp at the connection. For connected endpoints,
//! a smooth tangent has opposing outgoing directions from the shared point. A
//! sharp tangent has outgoing directions that point roughly the same way.

use std::collections::BTreeMap;

use super::model::InternalSegment;
use super::sampling::distance;
use super::types::SketchVisualizationCoincidentGroup;
use super::types::SketchVisualizationConstraintData;
use super::types::SketchVisualizationConstraintTarget;
use super::types::SketchVisualizationPoint;
use super::types::SketchVisualizationPointGroup;
use super::types::SketchVisualizationSharpTangentData;
use super::types::SketchVisualizationSharpTangentIncident;

const SHARP_ALIGNMENT_THRESHOLD: f64 = 0.5;
const MIN_TANGENT_STEP: f64 = 1.0e-9;

pub(super) fn sharp_tangents(
    segments: &BTreeMap<usize, InternalSegment>,
    constraints: &[SketchVisualizationConstraintData],
    contact_groups: &[SketchVisualizationPointGroup],
    coincident_groups: &[SketchVisualizationCoincidentGroup],
) -> SketchVisualizationSharpTangentData {
    let mut connections = EndpointConnections::new(segments);
    for group in contact_groups {
        connections.union_all(&group.point_ids);
    }
    for group in coincident_groups {
        connections.union_all(&group.point_ids);
    }

    let mut incidents = Vec::new();
    let mut segment_counts = BTreeMap::<usize, usize>::new();
    for constraint in constraints.iter().filter(|constraint| constraint.kind == "tangent") {
        let segment_ids = tangent_segment_ids(constraint);
        if segment_ids.len() != 2 {
            continue;
        }
        let Some(left) = segments.get(&segment_ids[0]) else {
            continue;
        };
        let Some(right) = segments.get(&segment_ids[1]) else {
            continue;
        };

        for (left_endpoint, right_endpoint, alignment, angle_degrees) in
            sharp_endpoint_pairs(left, right, &mut connections)
        {
            *segment_counts.entry(left.id).or_default() += 1;
            *segment_counts.entry(right.id).or_default() += 1;
            incidents.push(SketchVisualizationSharpTangentIncident {
                constraint_id: constraint.id,
                segment_ids: vec![left.id, right.id],
                endpoint_ids: vec![left_endpoint, right_endpoint],
                alignment,
                angle_degrees,
            });
        }
    }

    incidents.sort_by(|a, b| {
        (a.constraint_id, a.segment_ids.as_slice(), a.endpoint_ids.as_slice()).cmp(&(
            b.constraint_id,
            b.segment_ids.as_slice(),
            b.endpoint_ids.as_slice(),
        ))
    });
    SketchVisualizationSharpTangentData {
        segment_counts,
        incidents,
    }
}

fn tangent_segment_ids(constraint: &SketchVisualizationConstraintData) -> Vec<usize> {
    constraint
        .targets
        .iter()
        .filter_map(|target| match target {
            SketchVisualizationConstraintTarget::Object { id } => Some(*id),
            SketchVisualizationConstraintTarget::Origin => None,
        })
        .collect()
}

fn sharp_endpoint_pairs(
    left: &InternalSegment,
    right: &InternalSegment,
    connections: &mut EndpointConnections,
) -> Vec<(usize, usize, f64, f64)> {
    let mut pairs = Vec::new();
    for &left_endpoint in &left.endpoint_ids {
        for &right_endpoint in &right.endpoint_ids {
            if !connections.connected(left_endpoint, right_endpoint) {
                continue;
            }
            let Some(left_tangent) = outgoing_tangent(left, left_endpoint) else {
                continue;
            };
            let Some(right_tangent) = outgoing_tangent(right, right_endpoint) else {
                continue;
            };
            let alignment = dot(left_tangent, right_tangent).clamp(-1.0, 1.0);
            if alignment > SHARP_ALIGNMENT_THRESHOLD {
                pairs.push((
                    left_endpoint,
                    right_endpoint,
                    alignment,
                    libm::acos(alignment) * 180.0 / std::f64::consts::PI,
                ));
            }
        }
    }
    pairs
}

fn outgoing_tangent(segment: &InternalSegment, endpoint_id: usize) -> Option<SketchVisualizationPoint> {
    let polyline = segment.polylines.first()?;
    if polyline.len() < 2 {
        return None;
    }

    if Some(&endpoint_id) == segment.endpoint_ids.first() {
        direction_from_start(polyline)
    } else if Some(&endpoint_id) == segment.endpoint_ids.last() {
        direction_from_end(polyline)
    } else {
        None
    }
}

fn direction_from_start(polyline: &[SketchVisualizationPoint]) -> Option<SketchVisualizationPoint> {
    let start = *polyline.first()?;
    polyline
        .iter()
        .skip(1)
        .find_map(|point| normalized_delta(start, *point))
}

fn direction_from_end(polyline: &[SketchVisualizationPoint]) -> Option<SketchVisualizationPoint> {
    let end = *polyline.last()?;
    polyline
        .iter()
        .rev()
        .skip(1)
        .find_map(|point| normalized_delta(end, *point))
}

fn normalized_delta(from: SketchVisualizationPoint, to: SketchVisualizationPoint) -> Option<SketchVisualizationPoint> {
    let length = distance(from, to);
    if length <= MIN_TANGENT_STEP {
        return None;
    }
    Some(SketchVisualizationPoint {
        x: (to.x - from.x) / length,
        y: (to.y - from.y) / length,
    })
}

fn dot(left: SketchVisualizationPoint, right: SketchVisualizationPoint) -> f64 {
    left.x * right.x + left.y * right.y
}

#[derive(Debug, Clone)]
struct EndpointConnections {
    parent: BTreeMap<usize, usize>,
}

impl EndpointConnections {
    fn new(segments: &BTreeMap<usize, InternalSegment>) -> Self {
        Self {
            parent: segments
                .values()
                .flat_map(|segment| segment.endpoint_ids.iter().copied())
                .map(|id| (id, id))
                .collect(),
        }
    }

    fn union_all(&mut self, ids: &[usize]) {
        let Some(first) = ids.first().copied() else {
            return;
        };
        for id in ids.iter().skip(1) {
            self.union(first, *id);
        }
    }

    fn connected(&mut self, left: usize, right: usize) -> bool {
        self.find(left) == self.find(right)
    }

    fn find(&mut self, id: usize) -> usize {
        let parent = *self.parent.entry(id).or_insert(id);
        if parent == id {
            id
        } else {
            let root = self.find(parent);
            self.parent.insert(id, root);
            root
        }
    }

    fn union(&mut self, left: usize, right: usize) {
        let left_root = self.find(left);
        let right_root = self.find(right);
        if left_root == right_root {
            return;
        }
        let (low, high) = if left_root < right_root {
            (left_root, right_root)
        } else {
            (right_root, left_root)
        };
        self.parent.insert(high, low);
    }
}
