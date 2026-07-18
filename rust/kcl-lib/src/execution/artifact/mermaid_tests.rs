//! Test-only helpers for rendering the artifact graph as Mermaid diagrams.
use std::collections::BTreeMap;
use std::fmt::Write;

use ahash::AHashSet;

use super::*;

type NodeId = u32;

type Edges = IndexMap<(NodeId, NodeId), EdgeInfo>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EdgeInfo {
    direction: EdgeDirection,
    flow: EdgeFlow,
    kind: EdgeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum EdgeDirection {
    Forward,
    Backward,
    Bidirectional,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum EdgeFlow {
    SourceToTarget,
    TargetToSource,
}

impl EdgeFlow {
    #[must_use]
    fn reverse(&self) -> EdgeFlow {
        match self {
            EdgeFlow::SourceToTarget => EdgeFlow::TargetToSource,
            EdgeFlow::TargetToSource => EdgeFlow::SourceToTarget,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum EdgeKind {
    PathToSweep,
    Other,
}

impl EdgeDirection {
    #[must_use]
    fn merge(&self, other: EdgeDirection) -> EdgeDirection {
        match self {
            EdgeDirection::Forward => match other {
                EdgeDirection::Forward => EdgeDirection::Forward,
                EdgeDirection::Backward => EdgeDirection::Bidirectional,
                EdgeDirection::Bidirectional => EdgeDirection::Bidirectional,
            },
            EdgeDirection::Backward => match other {
                EdgeDirection::Forward => EdgeDirection::Bidirectional,
                EdgeDirection::Backward => EdgeDirection::Backward,
                EdgeDirection::Bidirectional => EdgeDirection::Bidirectional,
            },
            EdgeDirection::Bidirectional => EdgeDirection::Bidirectional,
        }
    }
}

/// Add an edge to the deduplicated edge map.
///
/// Mermaid renders `a --- b` and `b --- a` as two separate edges, so every edge
/// is stored under a canonical `(min, max)` key and duplicates are merged. Self
/// edges are skipped. `flow` records which endpoint the arrow points away from,
/// expressed relative to the canonical key orientation; `direction` is merged
/// so that seeing an edge in both directions collapses to `Bidirectional`.
fn add_unique_edge(edges: &mut Edges, source_id: NodeId, target_id: NodeId, flow: EdgeFlow, kind: EdgeKind) {
    if source_id == target_id {
        // Self edge.  Skip it.
        return;
    }
    // The key is the node IDs in canonical order.
    let a = source_id.min(target_id);
    let b = source_id.max(target_id);
    let new_direction = if a == source_id {
        EdgeDirection::Forward
    } else {
        EdgeDirection::Backward
    };
    let initial_flow = if a == source_id { flow } else { flow.reverse() };
    let edge = edges.entry((a, b)).or_insert(EdgeInfo {
        direction: new_direction,
        flow: initial_flow,
        kind,
    });
    // Merge with existing edge.
    edge.direction = edge.direction.merge(new_direction);
}

/// Assign a canonical node ID to each member of every duplicate group.
///
/// The members of a group are interchangeable duplicate segment nodes. They are
/// sorted by `signature_of` -- the semantic signature first, then a
/// raw-target-ID signature as a tie-breaker -- with the original node ID as a
/// final tie-breaker, and mapped onto the group's node IDs in ascending order.
/// So the member whose signature sorts first is assigned the smallest node ID
/// in the group. The returned map sends each node's current ID to its canonical
/// ID and is a permutation within each group. Singleton groups contribute
/// nothing.
///
/// The `node_ids` in each group are expected to already be sorted ascending;
/// that is the order canonical IDs are handed out in.
fn assign_canonical_source_ids(
    groups: &BTreeMap<String, Vec<NodeId>>,
    signature_of: impl Fn(NodeId) -> (String, String),
) -> AHashMap<NodeId, NodeId> {
    let mut source_remap = AHashMap::<NodeId, NodeId>::default();
    for node_ids in groups.values() {
        if node_ids.len() < 2 {
            // We have a singleton like: Node:1 -> [1]
            continue;
        }

        let mut signatures = node_ids
            .iter()
            .map(|&source_id| {
                let (semantic_edge_signature, target_id_edge_signature) = signature_of(source_id);
                (source_id, semantic_edge_signature, target_id_edge_signature)
            })
            .collect::<Vec<_>>();
        signatures.sort_by(|a, b| a.1.cmp(&b.1).then(a.2.cmp(&b.2)).then(a.0.cmp(&b.0)));

        for (canonical_source_id, (source_id, _, _)) in node_ids.iter().copied().zip(signatures) {
            source_remap.insert(source_id, canonical_source_id);
        }
    }
    source_remap
}

/// Deterministically re-pair equivalent edges between duplicate node classes.
///
/// Edges are grouped by their rendered class: the `node_key` of each endpoint
/// plus direction, flow, and kind. Within a group that forms a perfect matching
/// -- equal counts of distinct sources and distinct targets -- the sorted
/// sources are paired with the sorted targets. This normalizes the arbitrary
/// pairing the engine may return between otherwise-indistinguishable nodes.
/// Groups that are not perfect matchings (a shared source or target, i.e. a
/// many-to-one or one-to-many relationship) are left untouched.
fn canonicalize_duplicate_edge_pairings(
    edges: &mut [((NodeId, NodeId), EdgeInfo)],
    node_key: impl Fn(NodeId) -> String,
) {
    let mut edge_groups = BTreeMap::<String, Vec<usize>>::new();
    for (index, ((source_id, target_id), edge)) in edges.iter().enumerate() {
        edge_groups
            .entry(format!(
                "{}|{}|{:?}|{:?}|{:?}",
                node_key(*source_id),
                node_key(*target_id),
                edge.direction,
                edge.flow,
                edge.kind
            ))
            .or_default()
            .push(index);
    }
    for group in edge_groups.values() {
        if group.len() == 1 {
            continue;
        }

        let mut source_ids = group.iter().map(|index| edges[*index].0.0).collect::<Vec<_>>();
        let mut target_ids = group.iter().map(|index| edges[*index].0.1).collect::<Vec<_>>();
        source_ids.sort_unstable();
        source_ids.dedup();
        target_ids.sort_unstable();
        target_ids.dedup();

        // If two edges share a source or share a target, we do nothing. That
        // avoids incorrectly rewriting many-to-one or one-to-many relationships.
        if source_ids.len() != group.len() || target_ids.len() != group.len() {
            continue;
        }

        let mut group = group.clone();
        group.sort_by_key(|index| edges[*index].0.0);
        for (index, (source_id, target_id)) in group.into_iter().zip(source_ids.into_iter().zip(target_ids)) {
            edges[index].0 = (source_id, target_id);
        }
    }
}

impl Artifact {
    /// The IDs pointing back to prior nodes in a depth-first traversal of
    /// the graph.  This should be disjoint with `child_ids`.
    pub(crate) fn back_edges(&self) -> Vec<ArtifactId> {
        match self {
            Artifact::CompositeSolid(a) => {
                let mut ids = a.solid_ids.clone();
                ids.extend(a.tool_ids.iter());
                ids
            }
            Artifact::Plane(_) => Vec::new(),
            Artifact::Path(a) => {
                let mut ids = vec![a.plane_id];
                if let Some(sketch_block_id) = a.sketch_block_id {
                    ids.push(sketch_block_id);
                }
                if let Some(origin_path_id) = a.origin_path_id {
                    ids.push(origin_path_id);
                }
                if let Some(inner_path_id) = a.inner_path_id {
                    ids.push(inner_path_id);
                }
                if let Some(outer_path_id) = a.outer_path_id {
                    ids.push(outer_path_id);
                }
                ids
            }
            Artifact::Segment(a) => {
                let mut ids = vec![a.path_id];
                if let Some(original_id) = a.original_seg_id {
                    ids.push(original_id);
                }
                ids
            }
            Artifact::Solid2d(a) => vec![a.path_id],
            Artifact::PrimitiveFace(a) => vec![a.solid_id],
            Artifact::PrimitiveEdge(a) => vec![a.solid_id],
            Artifact::StartSketchOnFace(a) => vec![a.face_id],
            Artifact::StartSketchOnPlane(a) => vec![a.plane_id],
            Artifact::SketchBlock(a) => a.plane_id.map(|id| vec![id]).unwrap_or_default(),
            Artifact::SketchBlockConstraint(_) => Vec::new(),
            Artifact::PlaneOfFace(a) => vec![a.face_id],
            Artifact::Sweep(a) => {
                let mut ids = vec![a.path_id];
                if let Some(trajectory_id) = a.trajectory_id {
                    ids.push(trajectory_id);
                }
                ids
            }
            Artifact::Wall(a) => vec![a.seg_id, a.sweep_id],
            Artifact::Cap(a) => vec![a.sweep_id],
            Artifact::SweepEdge(a) => vec![a.seg_id, a.sweep_id],
            Artifact::EdgeCut(a) => vec![a.consumed_edge_id],
            Artifact::EdgeCutEdge(a) => vec![a.edge_cut_id],
            Artifact::Helix(a) => a.axis_id.map(|id| vec![id]).unwrap_or_default(),
            Artifact::GdtAnnotation(_) => Vec::new(),
            Artifact::Pattern(a) => vec![a.source_id],
        }
    }

    /// The child IDs of this artifact, used to do a depth-first traversal of
    /// the graph.
    pub(crate) fn child_ids(&self) -> Vec<ArtifactId> {
        match self {
            Artifact::CompositeSolid(a) => {
                // Note: Don't include these since they're parents: solid_ids,
                // tool_ids.
                let mut ids = Vec::new();
                if let Some(composite_solid_id) = a.composite_solid_id {
                    ids.push(composite_solid_id);
                }
                ids.extend(&a.pattern_ids);
                ids
            }
            Artifact::Plane(a) => a.path_ids.clone(),
            Artifact::Path(a) => {
                // Note: Don't include these since they're parents: plane_id,
                // sketch_block_id, origin_path_id, inner_path_id,
                // outer_path_id.
                let mut ids = a.seg_ids.clone();
                if let Some(sweep_id) = a.sweep_id {
                    ids.push(sweep_id);
                }
                if let Some(sweep_id_trajectory) = a.trajectory_sweep_id {
                    ids.push(sweep_id_trajectory);
                }
                if let Some(solid2d_id) = a.solid2d_id {
                    ids.push(solid2d_id);
                }
                if let Some(composite_solid_id) = a.composite_solid_id {
                    ids.push(composite_solid_id);
                }
                ids.extend(&a.pattern_ids);
                ids
            }
            Artifact::Segment(a) => {
                // Note: Don't include these since they're parents: path_id,
                // original_seg_id.
                let mut ids = Vec::new();
                if let Some(surface_id) = a.surface_id {
                    ids.push(surface_id);
                }
                ids.extend(&a.edge_ids);
                if let Some(edge_cut_id) = a.edge_cut_id {
                    ids.push(edge_cut_id);
                }
                ids.extend(&a.common_surface_ids);
                ids
            }
            Artifact::Solid2d(_) => {
                // Note: Don't include these since they're parents: path_id.
                Vec::new()
            }
            Artifact::PrimitiveFace(_) => {
                // Note: Don't include these since they're parents: solid_id.
                Vec::new()
            }
            Artifact::PrimitiveEdge(_) => {
                // Note: Don't include these since they're parents: solid_id.
                Vec::new()
            }
            Artifact::StartSketchOnFace { .. } => {
                // Note: Don't include these since they're parents: face_id.
                Vec::new()
            }
            Artifact::StartSketchOnPlane { .. } => {
                // Note: Don't include these since they're parents: plane_id.
                Vec::new()
            }
            Artifact::SketchBlock(a) => {
                // Note: Don't include these since they're parents: plane_id.
                let mut ids = Vec::new();
                if let Some(path_id) = a.path_id {
                    ids.push(path_id);
                }
                ids
            }
            Artifact::SketchBlockConstraint { .. } => {
                // Note: Constraints don't have artifact graph parents.
                Vec::new()
            }
            Artifact::PlaneOfFace { .. } => {
                // Note: Don't include these since they're parents: face_id.
                Vec::new()
            }
            Artifact::Sweep(a) => {
                // Note: Don't include these since they're parents: path_id.
                let mut ids = Vec::new();
                ids.extend(&a.surface_ids);
                ids.extend(&a.edge_ids);
                ids.extend(&a.pattern_ids);
                ids
            }
            Artifact::Wall(a) => {
                // Note: Don't include these since they're parents: seg_id,
                // sweep_id.
                let mut ids = Vec::new();
                ids.extend(&a.edge_cut_edge_ids);
                ids.extend(&a.path_ids);
                ids
            }
            Artifact::Cap(a) => {
                // Note: Don't include these since they're parents: sweep_id.
                let mut ids = Vec::new();
                ids.extend(&a.edge_cut_edge_ids);
                ids.extend(&a.path_ids);
                ids
            }
            Artifact::SweepEdge(a) => {
                // Note: Don't include these since they're parents: seg_id,
                // sweep_id.
                let mut ids = Vec::new();
                ids.extend(&a.common_surface_ids);
                ids
            }
            Artifact::EdgeCut(a) => {
                // Note: Don't include these since they're parents:
                // consumed_edge_id.
                let mut ids = Vec::new();
                ids.extend(&a.edge_ids);
                if let Some(surface_id) = a.surface_id {
                    ids.push(surface_id);
                }
                ids
            }
            Artifact::EdgeCutEdge(a) => {
                // Note: Don't include these since they're parents: edge_cut_id.
                vec![a.surface_id]
            }
            Artifact::Helix(a) => {
                // Note: Don't include these since they're parents: axis_id.
                let mut ids = Vec::new();
                if let Some(sweep_id) = a.trajectory_sweep_id {
                    ids.push(sweep_id);
                }
                ids
            }
            Artifact::GdtAnnotation(_) => Vec::new(),
            Artifact::Pattern(a) => {
                // Note: Don't include source_id since it's the parent.
                let mut ids = a.copy_ids.clone();
                ids.extend(&a.copy_face_ids);
                ids.extend(&a.copy_edge_ids);
                ids
            }
        }
    }
}

impl ArtifactGraph {
    /// Pattern nodes already summarize their generated copies and topology.
    /// Keep the materialized copy artifacts in the production graph, where
    /// selection and later operations need them, but omit that derived detail
    /// from test diagrams so large patterns remain readable.
    fn flowchart_omitted_pattern_copy_ids(&self) -> AHashSet<ArtifactId> {
        self.map
            .values()
            .filter_map(|artifact| match artifact {
                Artifact::Pattern(pattern) => Some(
                    pattern
                        .copy_ids
                        .iter()
                        .chain(&pattern.copy_face_ids)
                        .chain(&pattern.copy_edge_ids),
                ),
                _ => None,
            })
            .flatten()
            .copied()
            .collect()
    }

    /// Output the Mermaid flowchart for the artifact graph.
    pub(crate) fn to_mermaid_flowchart(&self) -> Result<String, std::fmt::Error> {
        let mut output = String::new();
        output.push_str("```mermaid\n");
        output.push_str("flowchart LR\n");

        let mut next_id = 1_u32;
        let mut stable_id_map = AHashMap::default();
        let omitted_ids = self.flowchart_omitted_pattern_copy_ids();

        for id in self.map.keys().filter(|id| !omitted_ids.contains(id)) {
            stable_id_map.insert(*id, next_id);
            next_id = next_id.checked_add(1).unwrap();
        }

        // Output all nodes first since edge order can change how Mermaid
        // lays out nodes.  This is also where we output more details about
        // the nodes, like their labels.
        self.flowchart_nodes(&mut output, &stable_id_map, "  ")?;
        self.flowchart_edges(&mut output, &stable_id_map, "  ")?;

        output.push_str("```\n");

        Ok(output)
    }

    /// Output the Mermaid flowchart nodes, one for each artifact.
    fn flowchart_nodes<W: Write>(
        &self,
        output: &mut W,
        stable_id_map: &AHashMap<ArtifactId, NodeId>,
        prefix: &str,
    ) -> std::fmt::Result {
        // Artifact ID of the path is the key.  The value is a list of
        // artifact IDs in that group.
        let mut groups = IndexMap::new();
        let mut ungrouped = Vec::new();

        for artifact in self.map.values() {
            let id = artifact.id();
            if !stable_id_map.contains_key(&id) {
                continue;
            }

            let grouped = match artifact {
                Artifact::CompositeSolid(_) => false,
                Artifact::Plane(_) => false,
                Artifact::Path(_) => {
                    groups.entry(id).or_insert_with(Vec::new).push(id);
                    true
                }
                Artifact::Segment(segment) => {
                    let path_id = segment.path_id;
                    groups.entry(path_id).or_insert_with(Vec::new).push(id);
                    true
                }
                Artifact::Solid2d(solid2d) => {
                    let path_id = solid2d.path_id;
                    groups.entry(path_id).or_insert_with(Vec::new).push(id);
                    true
                }
                Artifact::PrimitiveFace(_) | Artifact::PrimitiveEdge(_) => false,
                Artifact::StartSketchOnFace { .. }
                | Artifact::StartSketchOnPlane { .. }
                | Artifact::SketchBlock { .. }
                | Artifact::SketchBlockConstraint { .. }
                | Artifact::PlaneOfFace { .. }
                | Artifact::Sweep(_)
                | Artifact::Wall(_)
                | Artifact::Cap(_)
                | Artifact::SweepEdge(_)
                | Artifact::EdgeCut(_)
                | Artifact::EdgeCutEdge(_)
                | Artifact::Helix(_)
                | Artifact::GdtAnnotation(_)
                | Artifact::Pattern(_) => false,
            };
            if !grouped {
                ungrouped.push(id);
            }
        }

        for (group_id, artifact_ids) in groups {
            let group_id = *stable_id_map.get(&group_id).unwrap();
            writeln!(output, "{prefix}subgraph path{group_id} [Path]")?;
            let indented = format!("{prefix}  ");
            for artifact_id in artifact_ids {
                let artifact = self.map.get(&artifact_id).unwrap();
                let id = *stable_id_map.get(&artifact_id).unwrap();
                self.flowchart_node(output, artifact, id, &indented)?;
            }
            writeln!(output, "{prefix}end")?;
        }

        for artifact_id in ungrouped {
            let artifact = self.map.get(&artifact_id).unwrap();
            let id = *stable_id_map.get(&artifact_id).unwrap();
            self.flowchart_node(output, artifact, id, prefix)?;
        }

        Ok(())
    }

    fn flowchart_node<W: Write>(
        &self,
        output: &mut W,
        artifact: &Artifact,
        id: NodeId,
        prefix: &str,
    ) -> std::fmt::Result {
        // For now, only showing the source range.
        fn code_ref_display(code_ref: &CodeRef) -> [usize; 3] {
            let range = code_ref.range;
            [range.start(), range.end(), range.module_id().as_usize()]
        }
        fn node_path_display<W: Write>(
            output: &mut W,
            prefix: &str,
            label: Option<&str>,
            code_ref: &CodeRef,
        ) -> std::fmt::Result {
            // %% is a mermaid comment. Prefix is increased one level since it's
            // a child of the line above it.
            let label = label.unwrap_or("");
            if code_ref.node_path.is_empty() {
                return writeln!(output, "{prefix}  %% {label}Missing NodePath");
            }
            writeln!(output, "{prefix}  %% {label}{:?}", code_ref.node_path.steps)
        }

        match artifact {
            Artifact::CompositeSolid(composite_solid) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"CompositeSolid {:?}<br>{:?}<br>Consumed: {:?}\"]",
                    composite_solid.sub_type,
                    code_ref_display(&composite_solid.code_ref),
                    composite_solid.consumed
                )?;
                node_path_display(output, prefix, None, &composite_solid.code_ref)?;
            }
            Artifact::Plane(plane) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"Plane<br>{:?}\"]",
                    code_ref_display(&plane.code_ref)
                )?;
                node_path_display(output, prefix, None, &plane.code_ref)?;
            }
            Artifact::Path(path) => {
                let path_sub_type = if path.sub_type == PathSubType::Region {
                    " Region"
                } else {
                    ""
                };
                writeln!(
                    output,
                    "{prefix}{id}[\"Path{path_sub_type}<br>{:?}<br>Consumed: {:?}\"]",
                    code_ref_display(&path.code_ref),
                    path.consumed
                )?;
                node_path_display(output, prefix, None, &path.code_ref)?;
            }
            Artifact::Segment(segment) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"Segment<br>{:?}\"]",
                    code_ref_display(&segment.code_ref)
                )?;
                node_path_display(output, prefix, None, &segment.code_ref)?;
            }
            Artifact::Solid2d(_solid2d) => {
                writeln!(output, "{prefix}{id}[Solid2d]")?;
            }
            Artifact::PrimitiveFace(face) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"PrimitiveFace<br>{:?}\"]",
                    code_ref_display(&face.code_ref)
                )?;
                node_path_display(output, prefix, None, &face.code_ref)?;
            }
            Artifact::PrimitiveEdge(edge) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"PrimitiveEdge<br>{:?}\"]",
                    code_ref_display(&edge.code_ref)
                )?;
                node_path_display(output, prefix, None, &edge.code_ref)?;
            }
            Artifact::StartSketchOnFace(StartSketchOnFace { code_ref, .. }) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"StartSketchOnFace<br>{:?}\"]",
                    code_ref_display(code_ref)
                )?;
                node_path_display(output, prefix, None, code_ref)?;
            }
            Artifact::StartSketchOnPlane(StartSketchOnPlane { code_ref, .. }) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"StartSketchOnPlane<br>{:?}\"]",
                    code_ref_display(code_ref)
                )?;
                node_path_display(output, prefix, None, code_ref)?;
            }
            Artifact::SketchBlock(SketchBlock { code_ref, .. }) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"SketchBlock<br>{:?}\"]",
                    code_ref_display(code_ref)
                )?;
                node_path_display(output, prefix, None, code_ref)?;
            }
            Artifact::SketchBlockConstraint(constraint) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"SketchBlockConstraint {:?}<br>{:?}\"]",
                    constraint.constraint_type,
                    code_ref_display(&constraint.code_ref)
                )?;
                node_path_display(output, prefix, None, &constraint.code_ref)?;
            }
            Artifact::PlaneOfFace(PlaneOfFace { code_ref, .. }) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"PlaneOfFace<br>{:?}\"]",
                    code_ref_display(code_ref)
                )?;
                node_path_display(output, prefix, None, code_ref)?;
            }
            Artifact::Sweep(sweep) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"Sweep {:?}<br>{:?}<br>Consumed: {:?}\"]",
                    sweep.sub_type,
                    code_ref_display(&sweep.code_ref),
                    sweep.consumed,
                )?;
                node_path_display(output, prefix, None, &sweep.code_ref)?;
            }
            Artifact::Wall(wall) => {
                writeln!(output, "{prefix}{id}[Wall]")?;
                node_path_display(output, prefix, Some("face_code_ref="), &wall.face_code_ref)?;
            }
            Artifact::Cap(cap) => {
                writeln!(output, "{prefix}{id}[\"Cap {:?}\"]", cap.sub_type)?;
                node_path_display(output, prefix, Some("face_code_ref="), &cap.face_code_ref)?;
            }
            Artifact::SweepEdge(sweep_edge) => {
                writeln!(output, "{prefix}{id}[\"SweepEdge {:?}\"]", sweep_edge.sub_type)?;
            }
            Artifact::EdgeCut(edge_cut) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"EdgeCut {:?}<br>{:?}\"]",
                    edge_cut.sub_type,
                    code_ref_display(&edge_cut.code_ref)
                )?;
                node_path_display(output, prefix, None, &edge_cut.code_ref)?;
            }
            Artifact::EdgeCutEdge(_edge_cut_edge) => {
                writeln!(output, "{prefix}{id}[EdgeCutEdge]")?;
            }
            Artifact::Helix(helix) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"Helix<br>{:?}: Consumed: {:?}\"]",
                    code_ref_display(&helix.code_ref),
                    helix.consumed
                )?;
                node_path_display(output, prefix, None, &helix.code_ref)?;
            }
            Artifact::GdtAnnotation(annotation) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"GdtAnnotation<br>{:?}\"]",
                    code_ref_display(&annotation.code_ref)
                )?;
                node_path_display(output, prefix, None, &annotation.code_ref)?;
            }
            Artifact::Pattern(pattern) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"Pattern {:?}<br>{:?}<br>Copies: {}<br>Faces: {}<br>Edges: {}\"]",
                    pattern.sub_type,
                    code_ref_display(&pattern.code_ref),
                    pattern.copy_ids.len(),
                    pattern.copy_face_ids.len(),
                    pattern.copy_edge_ids.len(),
                )?;
                node_path_display(output, prefix, None, &pattern.code_ref)?;
            }
        }
        Ok(())
    }

    /// This function identifies the exact duplicate-node case we care about.
    /// Two `Segment` artifacts are considered duplicates only if they point
    /// back to the same KCL source range.
    ///
    /// That is important because region creation can emit generated segment
    /// artifacts that all point at the same region expression, not at unique
    /// source segment expressions. For example, a region artifact can generate
    /// several segment nodes with the same source range. In Mermaid, they are
    /// visually indistinguishable because they have the same label/range.
    ///
    /// For all other artifacts, this returns `None`. So this helper does not
    /// globally group `Wall`, `Cap`, `SweepEdge`, etc. It is intentionally
    /// scoped to duplicate segment nodes.
    ///
    /// Why only segment nodes? Because the instability we were trying to fix
    /// was edges flipping between duplicate segment nodes. The segment nodes
    /// were the unstable source-side anchors. If we canonicalize every
    /// generated artifact, we get closer to the broad sort we were trying to
    /// avoid.
    fn flowchart_duplicate_segment_key(artifact: &Artifact) -> Option<String> {
        fn code_ref_key(code_ref: &CodeRef) -> String {
            let range = code_ref.range;
            format!("{}:{}:{}", range.module_id().as_usize(), range.start(), range.end())
        }

        match artifact {
            Artifact::Segment(segment) => {
                // Distinguish region segments (created by CreateRegion, which
                // sets `original_seg_id`) from the original drawn segments they
                // reference. They can share an exact source range, e.g. when a
                // region is built from a profile via a pattern, which would
                // otherwise group them together as interchangeable duplicates.
                // They are NOT interchangeable: a region segment is linked to
                // its original by an `original_seg_id` edge, and putting both in
                // one duplicate group lets the canonical source remap fold that
                // intra-group edge into a self-edge. Keeping them in separate
                // groups makes the link an ordinary cross-group edge, handled
                // the same way as every other region.
                let kind = if segment.original_seg_id.is_some() {
                    "RegionSegment"
                } else {
                    "Segment"
                };
                Some(format!("{kind}:{}", code_ref_key(&segment.code_ref)))
            }
            _ => None,
        }
    }

    /// This function creates a stable semantic-ish string for an artifact. This
    /// is not used to reorder the graph globally. That distinction matters.
    ///
    /// It is used only to build signatures for comparing neighborhoods of
    /// duplicate segment nodes.
    ///
    /// The goal is to ask: "What kind of things does this generated segment
    /// connect to?" without caring about unstable UUIDs.
    ///
    /// For artifacts that have source code, the key includes source range,
    /// because source range is stable and meaningful. For generated artifacts
    /// that do not have source code, the key uses their broad type/subtype.
    /// This is enough to compare most generated neighborhoods semantically.
    ///
    /// We do not include UUIDs because UUIDs are exactly the kind of thing that
    /// can be noisy in snapshots. The Mermaid snapshot is supposed to help us
    /// see graph structure, not generated IDs.
    ///
    /// We also do not include actual node ID everywhere because that would bake
    /// the existing unstable assignment into the signature. The point is to
    /// compare semantic neighborhoods first.
    fn flowchart_basic_sort_key(artifact: &Artifact) -> String {
        fn code_ref_key(code_ref: &CodeRef) -> String {
            let range = code_ref.range;
            format!("{}:{}:{}", range.module_id().as_usize(), range.start(), range.end())
        }

        match artifact {
            Artifact::CompositeSolid(composite_solid) => {
                format!(
                    "CompositeSolid:{:?}:{}",
                    composite_solid.sub_type,
                    code_ref_key(&composite_solid.code_ref)
                )
            }
            Artifact::Plane(plane) => format!("Plane:{}", code_ref_key(&plane.code_ref)),
            Artifact::Path(path) => format!("Path:{:?}:{}", path.sub_type, code_ref_key(&path.code_ref)),
            Artifact::Segment(segment) => format!("Segment:{}", code_ref_key(&segment.code_ref)),
            Artifact::Solid2d(_) => "Solid2d".to_owned(),
            Artifact::PrimitiveFace(face) => format!("PrimitiveFace:{}", code_ref_key(&face.code_ref)),
            Artifact::PrimitiveEdge(edge) => format!("PrimitiveEdge:{}", code_ref_key(&edge.code_ref)),
            Artifact::StartSketchOnFace(StartSketchOnFace { code_ref, .. }) => {
                format!("StartSketchOnFace:{}", code_ref_key(code_ref))
            }
            Artifact::StartSketchOnPlane(StartSketchOnPlane { code_ref, .. }) => {
                format!("StartSketchOnPlane:{}", code_ref_key(code_ref))
            }
            Artifact::SketchBlock(SketchBlock { code_ref, .. }) => format!("SketchBlock:{}", code_ref_key(code_ref)),
            Artifact::SketchBlockConstraint(constraint) => {
                format!(
                    "SketchBlockConstraint:{:?}:{}",
                    constraint.constraint_type,
                    code_ref_key(&constraint.code_ref)
                )
            }
            Artifact::PlaneOfFace(PlaneOfFace { code_ref, .. }) => format!("PlaneOfFace:{}", code_ref_key(code_ref)),
            Artifact::Sweep(sweep) => format!("Sweep:{:?}:{}", sweep.sub_type, code_ref_key(&sweep.code_ref)),
            Artifact::Wall(_) => "Wall".to_owned(),
            Artifact::Cap(cap) => format!("Cap:{:?}", cap.sub_type),
            Artifact::SweepEdge(sweep_edge) => format!("SweepEdge:{:?}", sweep_edge.sub_type),
            Artifact::EdgeCut(edge_cut) => {
                format!("EdgeCut:{:?}:{}", edge_cut.sub_type, code_ref_key(&edge_cut.code_ref))
            }
            Artifact::EdgeCutEdge(_) => "EdgeCutEdge".to_owned(),
            Artifact::Helix(helix) => format!("Helix:{}", code_ref_key(&helix.code_ref)),
            Artifact::GdtAnnotation(annotation) => format!("GdtAnnotation:{}", code_ref_key(&annotation.code_ref)),
            Artifact::Pattern(pattern) => format!("Pattern:{:?}:{}", pattern.sub_type, code_ref_key(&pattern.code_ref)),
        }
    }

    fn flowchart_edges<W: Write>(
        &self,
        output: &mut W,
        stable_id_map: &AHashMap<ArtifactId, NodeId>,
        prefix: &str,
    ) -> Result<(), std::fmt::Error> {
        // Collect all edges, deduplicating them. `add_unique_edge` stores each
        // edge under a canonical `(min, max)` key and merges duplicates; Mermaid
        // would otherwise render `a --- b` and `b --- a` as two edges.
        let mut edges = IndexMap::default();
        for artifact in self.map.values() {
            let Some(&source_id) = stable_id_map.get(&artifact.id()) else {
                continue;
            };
            // In Mermaid, the textual order defines the rank, even though the
            // edge arrow can go in either direction.
            //
            // Back edges: parent <- self
            // Child edges: self -> child
            for (target_id, flow) in artifact
                .back_edges()
                .into_iter()
                .zip(std::iter::repeat(EdgeFlow::TargetToSource))
                .chain(
                    artifact
                        .child_ids()
                        .into_iter()
                        .zip(std::iter::repeat(EdgeFlow::SourceToTarget)),
                )
            {
                let Some(target) = self.map.get(&target_id) else {
                    continue;
                };
                let edge_kind = match (artifact, target) {
                    (Artifact::Path(_), Artifact::Sweep(_)) | (Artifact::Sweep(_), Artifact::Path(_)) => {
                        EdgeKind::PathToSweep
                    }
                    _ => EdgeKind::Other,
                };
                let Some(&target_id) = stable_id_map.get(&target_id) else {
                    continue;
                };
                add_unique_edge(&mut edges, source_id, target_id, flow, edge_kind);
            }
        }

        //====================================================================
        // The artifact graph contains generated topology artifacts. Some of
        // these artifacts are not directly written in source code. They are
        // generated as a result of engine/topology responses.
        //
        // This results in instability across test runs. The instability we saw
        // was not that a different model was being produced. It was that
        // equivalent generated topology could be returned in a different order,
        // which then caused Mermaid node IDs or edge attachment text to flip.
        //
        // See [crate::std::sketch::build_reverse_region_mapping] for more info
        // about the root cause.
        //
        // We had tried sorting everything, but it made the rendered Mermaid
        // diagrams much messier because it changed graph layout globally.
        // Mermaid's layout is very sensitive to ordering. The original ordering
        // is generally easier to understand because it roughly follows KCL
        // source/execution order.
        //====================================================================

        // Move into a Vec to make it easier to mutate edge endpoints in place.
        //
        // For unstable duplicate segment relationships, we rewrite `(source_id,
        // target_id)` pairs in `edges[index].0`.
        //
        // We preserve the existing insertion-order behavior up to this point.
        // We are not globally reordering edges here.
        let mut edges = edges.into_iter().collect::<Vec<_>>();

        let reverse_stable_id_map = stable_id_map
            .iter()
            .map(|(artifact_id, node_id)| (*node_id, *artifact_id))
            .collect::<AHashMap<_, _>>();

        // Key for deciding whether two nodes are interchangeable duplicate
        // segment nodes.
        //
        // Give each node a grouping key, such that only same-source-range
        // segment nodes collapse into the same grouping key. Every non-segment
        // node remains unique by node ID. This is one of the main protections
        // against accidentally canonicalizing too much of the graph.
        let node_key = |node_id: NodeId| {
            reverse_stable_id_map
                .get(&node_id)
                .and_then(|artifact_id| self.map.get(artifact_id))
                .and_then(Self::flowchart_duplicate_segment_key)
                .unwrap_or_else(|| format!("Node:{node_id}"))
        };
        // Key for describing a node semantically when building edge signatures.
        //
        // If we used `node_key` for signatures, we would include raw node IDs
        // too early and miss semantic equivalence.
        //
        // If we used `signature_node_key` for grouping, we would accidentally
        // group all walls/caps/sweep edges together and start globally
        // normalizing too much.
        let signature_node_key = |node_id: NodeId| {
            reverse_stable_id_map
                .get(&node_id)
                .and_then(|artifact_id| self.map.get(artifact_id))
                .map(Self::flowchart_basic_sort_key)
                .unwrap_or_else(|| format!("Node:{node_id}"))
        };
        // Some target nodes look semantically identical at the simple key
        // level. Two target nodes might both be "Wall" or both
        // "SweepEdge:Adjacent".
        //
        // A duplicate segment's outgoing edge signature might say "I connect to
        // a Wall and two SweepEdges" but two generated targets could have the
        // same basic key. So the segment signatures were still tied.
        //
        // So the neighborhood node key makes the target descriptions richer.
        // Instead of saying only "Wall", it says, "Wall|neighbors=<sorted list
        // of adjacent semantic relationships>".
        //
        // That lets us distinguish generated target nodes that have the same
        // artifact type but sit in different local graph neighborhoods.
        //
        // This is still local. It does not reorder the graph. It only improves
        // the signature used to decide which duplicate segment source should be
        // canonicalized to which node ID.
        //
        // Because the neighborhood node key contains the edge direction, flow,
        // and kind, the neighborhood signature is a structural fingerprint, not
        // just a list of labels.
        let neighborhood_node_key = |node_id: NodeId, edges: &[((NodeId, NodeId), EdgeInfo)]| {
            let mut neighbors = edges
                .iter()
                .filter_map(|((source_id, target_id), edge)| {
                    if *source_id == node_id {
                        Some(format!(
                            "out:{}|{:?}|{:?}|{:?}",
                            signature_node_key(*target_id),
                            edge.direction,
                            edge.flow,
                            edge.kind
                        ))
                    } else if *target_id == node_id {
                        Some(format!(
                            "in:{}|{:?}|{:?}|{:?}",
                            signature_node_key(*source_id),
                            edge.direction,
                            edge.flow,
                            edge.kind
                        ))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            neighbors.sort();
            format!("{}|neighbors={}", signature_node_key(node_id), neighbors.join(","))
        };

        // Build groups of nodes like:
        //
        // Segment:0:646:690 -> [8, 9, 10, 11, 12]
        // Node:1 -> [1]
        // Node:2 -> [2]
        // Node:3 -> [3]
        let mut duplicate_nodes = BTreeMap::<String, Vec<NodeId>>::new();
        let mut reverse_stable_node_ids = reverse_stable_id_map.keys().copied().collect::<Vec<_>>();
        reverse_stable_node_ids.sort_unstable();
        for node_id in reverse_stable_node_ids {
            duplicate_nodes.entry(node_key(node_id)).or_default().push(node_id);
        }
        for node_ids in duplicate_nodes.values_mut() {
            node_ids.sort_unstable();
        }
        // Build each duplicate segment node's signature from its outgoing
        // edges, then let `assign_canonical_source_ids` pick canonical node IDs.
        // The signature describes each outgoing edge by the *semantic*
        // neighborhood of its target (via `neighborhood_node_key`, not raw node
        // IDs), so equivalent engine output produces the same assignment. A
        // second signature built from raw target IDs is used only as a
        // tie-breaker for duplicate segments that are genuinely
        // indistinguishable at the semantic level (e.g. symmetric geometry).
        let signature_of = |source_id: NodeId| -> (String, String) {
            let mut semantic_edge_signature = edges
                .iter()
                .filter_map(|((edge_source_id, target_id), edge)| {
                    if *edge_source_id != source_id {
                        return None;
                    }
                    Some(format!(
                        "{}|{:?}|{:?}|{:?}",
                        neighborhood_node_key(*target_id, &edges),
                        edge.direction,
                        edge.flow,
                        edge.kind
                    ))
                })
                .collect::<Vec<_>>();
            semantic_edge_signature.sort();

            let mut target_id_edge_signature = edges
                .iter()
                .filter_map(|((edge_source_id, target_id), edge)| {
                    if *edge_source_id != source_id {
                        return None;
                    }
                    Some(format!(
                        "{}|{:?}|{:?}|{:?}",
                        target_id, edge.direction, edge.flow, edge.kind
                    ))
                })
                .collect::<Vec<_>>();
            target_id_edge_signature.sort();

            (semantic_edge_signature.join(","), target_id_edge_signature.join(","))
        };
        let source_remap = assign_canonical_source_ids(&duplicate_nodes, signature_of);

        // Apply the remap to edge sources. A duplicate segment and its original
        // live in different groups (see `flowchart_duplicate_segment_key`), so
        // this never rewrites both endpoints of one edge and cannot create a
        // self-edge.
        for ((source_id, _), _) in &mut edges {
            if let Some(canonical_source_id) = source_remap.get(source_id) {
                *source_id = *canonical_source_id;
            }
        }

        //====================================================================
        // Do a second, even more local normalization pass.
        //
        // Region creation emits several segment artifacts with the same source
        // range. When engine topology returns those symmetric segments in a
        // different order, the Mermaid graph is semantically unchanged but a
        // directed edge can flip between duplicate segment node IDs. Normalize
        // only that duplicate-segment case and leave node ordering alone.
        //
        // This pass addresses a related but slightly different flip from
        // `source_remap`. `source_remap` handles "which duplicate segment
        // source node owns which adjacency set?"
        //
        // On the other hand, `edge_groups` handles "inside a group of
        // equivalent edges between duplicate-ish nodes, pair the sorted sources
        // and sorted targets deterministically."
        //
        // This is useful when the instability is not just the source adjacency
        // set, but the pairing of equivalent source/target nodes.
        //====================================================================

        // Group edges by their rendered class -- keyed by `node_key`, so walls
        // and other unique nodes are never grouped together -- and re-pair
        // perfect matchings deterministically. For example, one run may emit
        // `8 -> 27, 9 -> 21` and another `8 -> 21, 9 -> 27`; both normalize to
        // the sorted pairing `8 -> 21, 9 -> 27`.
        canonicalize_duplicate_edge_pairings(&mut edges, node_key);

        edges.sort_by(|a, b| {
            let ak = a.0;
            let bk = b.0;
            if ak.0 == bk.0 { ak.1.cmp(&bk.1) } else { ak.0.cmp(&bk.0) }
        });

        for ((source_id, target_id), edge) in edges {
            // Guard: normalization must never collapse an edge onto one node.
            // `add_unique_edge` skips self-edges when collecting, and the
            // passes above only permute endpoints among interchangeable
            // duplicate segment nodes. Some duplicate groups do legitimately
            // contain intra-group edges (a region segment linked via
            // `original_seg_id` to an original segment that shares its code
            // range), and the sources-only remap could in principle fold such
            // an edge into a self-edge; on all current inputs it never does. If
            // that ever changes we would silently emit a bogus `N --- N` line,
            // so fail loudly here instead of committing a corrupt snapshot.
            assert_ne!(
                source_id, target_id,
                "artifact graph Mermaid normalization produced a self-edge on node {source_id}"
            );
            let extra = match edge.kind {
                // Extra length.  This is needed to make the graph layout more
                // legible.  Without it, the sweep will be at the same rank as
                // the path's segments, and the sweep's edges overlap with the
                // segment edges a lot.
                EdgeKind::PathToSweep => "-",
                EdgeKind::Other => "",
            };
            match edge.flow {
                EdgeFlow::SourceToTarget => match edge.direction {
                    EdgeDirection::Forward => {
                        writeln!(output, "{prefix}{source_id} x{extra}--> {target_id}")?;
                    }
                    EdgeDirection::Backward => {
                        writeln!(output, "{prefix}{source_id} <{extra}--x {target_id}")?;
                    }
                    EdgeDirection::Bidirectional => {
                        writeln!(output, "{prefix}{source_id} {extra}--- {target_id}")?;
                    }
                },
                EdgeFlow::TargetToSource => match edge.direction {
                    EdgeDirection::Forward => {
                        writeln!(output, "{prefix}{target_id} x{extra}--> {source_id}")?;
                    }
                    EdgeDirection::Backward => {
                        writeln!(output, "{prefix}{target_id} <{extra}--x {source_id}")?;
                    }
                    EdgeDirection::Bidirectional => {
                        writeln!(output, "{prefix}{target_id} {extra}--- {source_id}")?;
                    }
                },
            }
        }

        Ok(())
    }
}

#[test]
fn pattern_traversal_links_source_and_copied_geometry() {
    let source_id = ArtifactId::new(Uuid::new_v4());
    let copy_id = ArtifactId::new(Uuid::new_v4());
    let copy_face_id = ArtifactId::new(Uuid::new_v4());
    let copy_edge_id = ArtifactId::new(Uuid::new_v4());

    let artifact = Artifact::Pattern(Pattern {
        id: ArtifactId::new(Uuid::new_v4()),
        sub_type: PatternSubType::Circular,
        source_id,
        copy_ids: vec![copy_id],
        copy_face_ids: vec![copy_face_id],
        copy_edge_ids: vec![copy_edge_id],
        code_ref: CodeRef::placeholder(SourceRange::synthetic()),
    });

    assert_eq!(artifact.back_edges(), vec![source_id]);
    assert_eq!(artifact.child_ids(), vec![copy_id, copy_face_id, copy_edge_id]);
}

// ---------------------------------------------------------------------------
// Unit tests for the Mermaid normalization helpers.
//
// The flowchart renderer canonicalizes an otherwise unstable graph (see the
// module docs and `flowchart_edges`). These tests pin the invariants each
// helper relies on so the behavior is documented and regressions are caught
// without having to run the full engine-backed snapshot suite.
// ---------------------------------------------------------------------------

fn other_edge() -> EdgeInfo {
    EdgeInfo {
        direction: EdgeDirection::Forward,
        flow: EdgeFlow::SourceToTarget,
        kind: EdgeKind::Other,
    }
}

fn segment_artifact(original_seg_id: Option<ArtifactId>) -> Artifact {
    Artifact::Segment(Segment {
        id: ArtifactId::new(Uuid::new_v4()),
        path_id: ArtifactId::new(Uuid::new_v4()),
        original_seg_id,
        surface_id: None,
        edge_ids: Vec::new(),
        edge_cut_id: None,
        code_ref: CodeRef::placeholder(SourceRange::synthetic()),
        common_surface_ids: Vec::new(),
    })
}

#[test]
fn edge_flow_reverse_is_an_involution() {
    assert_eq!(EdgeFlow::SourceToTarget.reverse(), EdgeFlow::TargetToSource);
    assert_eq!(EdgeFlow::TargetToSource.reverse(), EdgeFlow::SourceToTarget);
    assert_eq!(EdgeFlow::SourceToTarget.reverse().reverse(), EdgeFlow::SourceToTarget);
}

#[test]
fn edge_direction_merge_collapses_opposite_directions() {
    use EdgeDirection::Backward;
    use EdgeDirection::Bidirectional;
    use EdgeDirection::Forward;
    // A repeated direction is unchanged.
    assert_eq!(Forward.merge(Forward), Forward);
    assert_eq!(Backward.merge(Backward), Backward);
    // Opposite orientations of the same edge collapse to bidirectional.
    assert_eq!(Forward.merge(Backward), Bidirectional);
    assert_eq!(Backward.merge(Forward), Bidirectional);
    // Bidirectional is absorbing.
    assert_eq!(Bidirectional.merge(Forward), Bidirectional);
    assert_eq!(Bidirectional.merge(Backward), Bidirectional);
    assert_eq!(Forward.merge(Bidirectional), Bidirectional);
    assert_eq!(Backward.merge(Bidirectional), Bidirectional);
}

#[test]
fn add_unique_edge_skips_self_edges() {
    let mut edges = Edges::default();
    add_unique_edge(&mut edges, 5, 5, EdgeFlow::SourceToTarget, EdgeKind::Other);
    assert!(edges.is_empty());
}

#[test]
fn add_unique_edge_stores_canonical_min_max_key() {
    // Insert with source > target. The key is normalized to (min, max) and the
    // orientation is recorded in `direction`/`flow` relative to that key.
    let mut edges = Edges::default();
    add_unique_edge(&mut edges, 7, 3, EdgeFlow::SourceToTarget, EdgeKind::Other);
    let (key, info) = edges.iter().next().unwrap();
    assert_eq!(*key, (3, 7));
    // a (3) != source (7), so direction is Backward and the flow is reversed.
    assert_eq!(info.direction, EdgeDirection::Backward);
    assert_eq!(info.flow, EdgeFlow::TargetToSource);
}

#[test]
fn add_unique_edge_merges_opposite_directions_to_bidirectional() {
    let mut edges = Edges::default();
    // The same node pair inserted in both orientations.
    add_unique_edge(&mut edges, 3, 7, EdgeFlow::SourceToTarget, EdgeKind::Other);
    add_unique_edge(&mut edges, 7, 3, EdgeFlow::SourceToTarget, EdgeKind::Other);
    assert_eq!(edges.len(), 1);
    let info = edges.get(&(3, 7)).unwrap();
    assert_eq!(info.direction, EdgeDirection::Bidirectional);
    // Flow reflects the first insert (a == source == 3, so it is left as-is).
    assert_eq!(info.flow, EdgeFlow::SourceToTarget);
}

#[test]
fn add_unique_edge_keeps_a_repeated_direction() {
    let mut edges = Edges::default();
    add_unique_edge(&mut edges, 3, 7, EdgeFlow::SourceToTarget, EdgeKind::Other);
    add_unique_edge(&mut edges, 3, 7, EdgeFlow::SourceToTarget, EdgeKind::Other);
    assert_eq!(edges.len(), 1);
    assert_eq!(edges.get(&(3, 7)).unwrap().direction, EdgeDirection::Forward);
}

#[test]
fn duplicate_segment_key_separates_region_from_original() {
    // An original drawn segment and a region segment can share an exact source
    // range, but they are not interchangeable: the region segment carries an
    // `original_seg_id` back to the original, and the two are joined by an edge.
    // They must get different grouping keys so the source remap never folds that
    // linking edge into a self-edge.
    let original = segment_artifact(None);
    let region = segment_artifact(Some(ArtifactId::new(Uuid::new_v4())));

    let original_key = ArtifactGraph::flowchart_duplicate_segment_key(&original).unwrap();
    let region_key = ArtifactGraph::flowchart_duplicate_segment_key(&region).unwrap();

    assert!(original_key.starts_with("Segment:"), "got {original_key}");
    assert!(region_key.starts_with("RegionSegment:"), "got {region_key}");
    assert_ne!(original_key, region_key);
}

#[test]
fn duplicate_segment_key_is_none_for_non_segments() {
    let pattern = Artifact::Pattern(Pattern {
        id: ArtifactId::new(Uuid::new_v4()),
        sub_type: PatternSubType::Circular,
        source_id: ArtifactId::new(Uuid::new_v4()),
        copy_ids: Vec::new(),
        copy_face_ids: Vec::new(),
        copy_edge_ids: Vec::new(),
        code_ref: CodeRef::placeholder(SourceRange::synthetic()),
    });
    assert!(ArtifactGraph::flowchart_duplicate_segment_key(&pattern).is_none());
}

#[test]
fn flowchart_omits_materialized_pattern_copy_artifacts() {
    let pattern_id = ArtifactId::new(Uuid::new_v4());
    let copy_id = ArtifactId::new(Uuid::new_v4());
    let copy_face_id = ArtifactId::new(Uuid::new_v4());
    let copy_edge_id = ArtifactId::new(Uuid::new_v4());
    let mut graph = ArtifactGraph::default();
    graph.map.insert(
        pattern_id,
        Artifact::Pattern(Pattern {
            id: pattern_id,
            sub_type: PatternSubType::Linear,
            source_id: ArtifactId::new(Uuid::new_v4()),
            copy_ids: vec![copy_id],
            copy_face_ids: vec![copy_face_id],
            copy_edge_ids: vec![copy_edge_id],
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
        }),
    );

    let omitted = graph.flowchart_omitted_pattern_copy_ids();
    assert_eq!(omitted, AHashSet::from_iter([copy_id, copy_face_id, copy_edge_id]));
    assert!(!omitted.contains(&pattern_id));
}

#[test]
fn assign_canonical_source_ids_orders_by_signature() {
    // Node IDs 10, 20, 30 whose semantic signatures sort in a different order.
    // The member whose signature sorts first gets the smallest node ID.
    let mut groups = BTreeMap::new();
    groups.insert("g".to_owned(), vec![10u32, 20, 30]);
    let sigs: std::collections::HashMap<NodeId, (String, String)> = [
        (10, ("c".to_owned(), String::new())),
        (20, ("a".to_owned(), String::new())),
        (30, ("b".to_owned(), String::new())),
    ]
    .into_iter()
    .collect();

    let remap = assign_canonical_source_ids(&groups, |id| sigs[&id].clone());

    // Signature order a < b < c => members 20, 30, 10 => canonical IDs 10, 20, 30.
    assert_eq!(remap.get(&20), Some(&10));
    assert_eq!(remap.get(&30), Some(&20));
    assert_eq!(remap.get(&10), Some(&30));
}

#[test]
fn assign_canonical_source_ids_breaks_ties_by_target_signature() {
    let mut groups = BTreeMap::new();
    groups.insert("g".to_owned(), vec![10u32, 20, 30]);
    // 10 and 20 tie on the semantic signature ("a"); the raw-target signature
    // breaks the tie ("b" < "z"). 30 differs on the semantic signature.
    let sigs: std::collections::HashMap<NodeId, (String, String)> = [
        (10, ("a".to_owned(), "z".to_owned())),
        (20, ("a".to_owned(), "b".to_owned())),
        (30, ("z".to_owned(), String::new())),
    ]
    .into_iter()
    .collect();

    let remap = assign_canonical_source_ids(&groups, |id| sigs[&id].clone());

    // Order: 20("a","b"), 10("a","z"), 30("z") => canonical IDs 10, 20, 30.
    assert_eq!(remap.get(&20), Some(&10));
    assert_eq!(remap.get(&10), Some(&20));
    assert_eq!(remap.get(&30), Some(&30));
}

#[test]
fn assign_canonical_source_ids_skips_singleton_groups() {
    let mut groups = BTreeMap::new();
    groups.insert("g".to_owned(), vec![42u32]);
    let remap = assign_canonical_source_ids(&groups, |_| (String::new(), String::new()));
    assert!(remap.is_empty());
}

#[test]
fn canonicalize_edge_pairings_normalizes_perfect_matchings() {
    // Two edges from one duplicate class {8, 9} to another {21, 27}, paired in
    // an arbitrary order. All four nodes are interchangeable within their class,
    // so the pairing is normalized to sorted-source -> sorted-target.
    let mut edges = vec![((8u32, 27u32), other_edge()), ((9u32, 21u32), other_edge())];
    let node_key = |id: NodeId| match id {
        8 | 9 => "src".to_owned(),
        21 | 27 => "dst".to_owned(),
        other => format!("Node:{other}"),
    };

    canonicalize_duplicate_edge_pairings(&mut edges, node_key);

    let mut pairs = edges.iter().map(|(key, _)| *key).collect::<Vec<_>>();
    pairs.sort_unstable();
    assert_eq!(pairs, vec![(8, 21), (9, 27)]);
}

#[test]
fn canonicalize_edge_pairings_leaves_many_to_one_alone() {
    // Both sources point at the same target: not a perfect matching, so the
    // pairing is left untouched.
    let mut edges = vec![((8u32, 21u32), other_edge()), ((9u32, 21u32), other_edge())];
    let node_key = |id: NodeId| match id {
        8 | 9 => "src".to_owned(),
        21 => "dst".to_owned(),
        other => format!("Node:{other}"),
    };

    let before = edges.clone();
    canonicalize_duplicate_edge_pairings(&mut edges, node_key);
    assert_eq!(edges, before);
}

#[test]
fn canonicalize_edge_pairings_does_not_group_unique_nodes() {
    // The targets have unique node keys (like walls), so the two edges never
    // land in the same group and nothing is re-paired.
    let mut edges = vec![((8u32, 100u32), other_edge()), ((9u32, 200u32), other_edge())];
    let node_key = |id: NodeId| match id {
        8 | 9 => "src".to_owned(),
        other => format!("Node:{other}"),
    };

    let before = edges.clone();
    canonicalize_duplicate_edge_pairings(&mut edges, node_key);
    assert_eq!(edges, before);
}
