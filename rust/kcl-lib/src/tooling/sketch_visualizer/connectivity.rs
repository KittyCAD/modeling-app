//! Sketch connectedness and closedness analysis.
//!
//! The renderer only needs polylines, but downstream tools need to know whether
//! geometry is connected by coordinates, by explicit coincident constraints, or
//! not connected at all. This module turns points and segment endpoints into a
//! few stable graph-shaped sidecar facts.

use std::collections::BTreeMap;
use std::collections::BTreeSet;

use super::model::ComponentResult;
use super::model::InternalPoint;
use super::model::InternalSegment;
use super::sampling::distance;
use super::types::SketchVisualizationClosednessHint;
use super::types::SketchVisualizationCoincidentGroup;
use super::types::SketchVisualizationConnectedComponent;
use super::types::SketchVisualizationConstraintData;
use super::types::SketchVisualizationConstraintTarget;
use super::types::SketchVisualizationPointGroup;

pub(super) fn contact_groups(
    points: &BTreeMap<usize, InternalPoint>,
    contact_tolerance: f64,
) -> Vec<SketchVisualizationPointGroup> {
    let point_ids = points.keys().copied().collect::<Vec<_>>();
    let mut union = UnionFind::new(point_ids.iter().copied());
    let tolerance = libm::fmax(contact_tolerance, 0.0);

    // Contact groups are purely geometric. Union every pair of points whose
    // coordinates fall inside the tolerance, then emit only multi-point sets.
    for (left_index, left_id) in point_ids.iter().enumerate() {
        for right_id in point_ids.iter().skip(left_index + 1) {
            let left = points[left_id].position;
            let right = points[right_id].position;
            if distance(left, right) <= tolerance {
                union.union(*left_id, *right_id);
            }
        }
    }

    point_groups_from_union(point_ids, &mut union)
}

pub(super) fn coincident_groups(
    constraints: &[SketchVisualizationConstraintData],
    points: &BTreeMap<usize, InternalPoint>,
) -> Vec<SketchVisualizationCoincidentGroup> {
    let mut union = UnionFind::new(points.keys().copied());
    let mut active_point_ids = BTreeSet::new();
    let mut origin_anchor = None;
    let mut roots_including_origin = BTreeSet::new();

    // Coincident constraints can mention more than two points, and multiple
    // constraints can chain together. Union-find gives the transitive closure so
    // callers see the full explicit coincidence group rather than constraint
    // pairs.
    for constraint in constraints.iter().filter(|constraint| constraint.kind == "coincident") {
        let mut point_ids = Vec::new();
        let mut includes_origin = false;
        for target in &constraint.targets {
            match target {
                SketchVisualizationConstraintTarget::Object { id } if points.contains_key(id) => point_ids.push(*id),
                SketchVisualizationConstraintTarget::Object { .. } => {}
                SketchVisualizationConstraintTarget::Origin => includes_origin = true,
            }
        }
        point_ids.sort_unstable();
        point_ids.dedup();
        active_point_ids.extend(point_ids.iter().copied());
        union_all(&mut union, &point_ids);

        if includes_origin && let Some(first_point_id) = point_ids.first().copied() {
            if let Some(anchor) = origin_anchor {
                union.union(anchor, first_point_id);
            } else {
                origin_anchor = Some(first_point_id);
            }
            roots_including_origin.insert(first_point_id);
        }
    }

    let mut root_to_points = BTreeMap::<usize, Vec<usize>>::new();
    for point_id in active_point_ids {
        root_to_points.entry(union.find(point_id)).or_default().push(point_id);
    }

    let mut root_includes_origin = BTreeSet::new();
    for point_id in roots_including_origin {
        root_includes_origin.insert(union.find(point_id));
    }

    root_to_points
        .into_iter()
        .filter_map(|(root, mut point_ids)| {
            point_ids.sort_unstable();
            let includes_origin = root_includes_origin.contains(&root);
            if point_ids.len() > 1 || includes_origin {
                Some(SketchVisualizationCoincidentGroup {
                    id: 0,
                    point_ids,
                    includes_origin,
                })
            } else {
                None
            }
        })
        .enumerate()
        .map(|(id, mut group)| {
            group.id = id;
            group
        })
        .collect()
}

pub(super) fn point_group_index(groups: &[SketchVisualizationPointGroup]) -> BTreeMap<usize, usize> {
    groups
        .iter()
        .flat_map(|group| group.point_ids.iter().map(move |point_id| (*point_id, group.id)))
        .collect()
}

pub(super) fn connected_components(
    segments: &BTreeMap<usize, InternalSegment>,
    contact_groups: &[SketchVisualizationPointGroup],
    coincident_groups: &[SketchVisualizationCoincidentGroup],
) -> ComponentResult {
    let segment_ids = segments.keys().copied().collect::<Vec<_>>();
    let mut union = UnionFind::new(segment_ids.iter().copied());
    let endpoint_to_segments = endpoint_to_segments(segments);

    // First union segments that literally share endpoint IDs. Then apply the two
    // point-group systems so coincident-but-distinct endpoint IDs connect the
    // same way shared IDs do.
    for segment_ids_for_endpoint in endpoint_to_segments.values() {
        union_all(&mut union, segment_ids_for_endpoint);
    }
    for group in contact_groups {
        let touching_segments = segments_touching_points(&endpoint_to_segments, &group.point_ids);
        union_all(&mut union, &touching_segments);
    }
    for group in coincident_groups {
        let coincident_segments = segments_touching_points(&endpoint_to_segments, &group.point_ids);
        union_all(&mut union, &coincident_segments);
    }

    let mut root_to_segments: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for segment_id in segment_ids {
        root_to_segments
            .entry(union.find(segment_id))
            .or_default()
            .push(segment_id);
    }

    let mut segment_to_component = BTreeMap::new();
    let mut components = Vec::new();
    for (component_id, (_, mut component_segment_ids)) in root_to_segments.into_iter().enumerate() {
        component_segment_ids.sort_unstable();
        for segment_id in &component_segment_ids {
            segment_to_component.insert(*segment_id, component_id);
        }
        components.push(SketchVisualizationConnectedComponent {
            id: component_id,
            segment_ids: component_segment_ids,
        });
    }

    // Closedness is endpoint-centric rather than segment-centric. We union
    // endpoints through contact/coincident groups, count how many segment
    // endpoints land in each endpoint connection, and flag singleton
    // connections as open.
    let mut endpoint_connection_union = UnionFind::new(
        segments
            .values()
            .flat_map(|segment| segment.endpoint_ids.iter().copied()),
    );
    for group in contact_groups {
        union_all(&mut endpoint_connection_union, &group.point_ids);
    }
    for group in coincident_groups {
        union_all(&mut endpoint_connection_union, &group.point_ids);
    }

    let mut endpoint_counts_by_connection_root = BTreeMap::<usize, usize>::new();
    for segment in segments.values() {
        for endpoint_id in &segment.endpoint_ids {
            let root = endpoint_connection_union.find(*endpoint_id);
            *endpoint_counts_by_connection_root.entry(root).or_default() += 1;
        }
    }

    let mut open_endpoints_by_component = BTreeMap::<usize, Vec<usize>>::new();
    let mut open_endpoints = Vec::new();
    for segment in segments.values() {
        let component_id = segment_to_component.get(&segment.id).copied().unwrap_or_default();
        for endpoint_id in &segment.endpoint_ids {
            let root = endpoint_connection_union.find(*endpoint_id);
            let connected_count = endpoint_counts_by_connection_root
                .get(&root)
                .copied()
                .unwrap_or_default();
            if connected_count < 2 {
                open_endpoints.push(*endpoint_id);
                open_endpoints_by_component
                    .entry(component_id)
                    .or_default()
                    .push(*endpoint_id);
            }
        }
    }
    open_endpoints.sort_unstable();
    open_endpoints.dedup();

    let closedness_hints = components
        .iter()
        .map(|component| {
            let mut component_open_endpoints = open_endpoints_by_component.remove(&component.id).unwrap_or_default();
            component_open_endpoints.sort_unstable();
            component_open_endpoints.dedup();
            SketchVisualizationClosednessHint {
                component_id: component.id,
                is_closed: component_open_endpoints.is_empty(),
                open_endpoint_ids: component_open_endpoints,
            }
        })
        .collect();

    ComponentResult {
        components,
        segment_to_component,
        open_endpoints,
        closedness_hints,
    }
}

fn endpoint_to_segments(segments: &BTreeMap<usize, InternalSegment>) -> BTreeMap<usize, Vec<usize>> {
    let mut endpoints = BTreeMap::<usize, Vec<usize>>::new();
    for segment in segments.values() {
        for endpoint_id in &segment.endpoint_ids {
            endpoints.entry(*endpoint_id).or_default().push(segment.id);
        }
    }
    endpoints
}

fn segments_touching_points(endpoint_to_segments: &BTreeMap<usize, Vec<usize>>, point_ids: &[usize]) -> Vec<usize> {
    let mut segment_ids = point_ids
        .iter()
        .filter_map(|point_id| endpoint_to_segments.get(point_id))
        .flatten()
        .copied()
        .collect::<Vec<_>>();
    segment_ids.sort_unstable();
    segment_ids.dedup();
    segment_ids
}

fn union_all(union: &mut UnionFind, ids: &[usize]) {
    let Some(first) = ids.first().copied() else {
        return;
    };
    for id in ids.iter().skip(1) {
        union.union(first, *id);
    }
}

fn point_groups_from_union(mut point_ids: Vec<usize>, union: &mut UnionFind) -> Vec<SketchVisualizationPointGroup> {
    point_ids.sort_unstable();
    let mut root_to_points: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for point_id in point_ids {
        root_to_points.entry(union.find(point_id)).or_default().push(point_id);
    }

    root_to_points
        .into_values()
        .filter(|point_ids| point_ids.len() > 1)
        .enumerate()
        .map(|(id, point_ids)| SketchVisualizationPointGroup { id, point_ids })
        .collect()
}

/// Small deterministic disjoint-set helper for object IDs.
///
/// Connectivity facts need stable ordering for snapshots and downstream JSON.
/// This keeps the lower numeric root when merging sets, so repeated runs produce
/// the same group IDs after the final BTreeMap enumeration.
#[derive(Debug, Clone)]
struct UnionFind {
    parent: BTreeMap<usize, usize>,
}

impl UnionFind {
    fn new(ids: impl IntoIterator<Item = usize>) -> Self {
        Self {
            parent: ids.into_iter().map(|id| (id, id)).collect(),
        }
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

    fn union(&mut self, a: usize, b: usize) {
        let root_a = self.find(a);
        let root_b = self.find(b);
        if root_a == root_b {
            return;
        }
        let (low, high) = if root_a < root_b {
            (root_a, root_b)
        } else {
            (root_b, root_a)
        };
        self.parent.insert(high, low);
    }
}
