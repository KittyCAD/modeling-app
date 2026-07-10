//! Test-only helpers for rendering the artifact graph as Mermaid diagrams.
use std::collections::BTreeMap;
use std::fmt::Write;

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
    /// Output the Mermaid flowchart for the artifact graph.
    pub(crate) fn to_mermaid_flowchart(&self) -> Result<String, std::fmt::Error> {
        let mut output = String::new();
        output.push_str("```mermaid\n");
        output.push_str("flowchart LR\n");

        let mut next_id = 1_u32;
        let mut stable_id_map = AHashMap::default();

        for id in self.map.keys() {
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
        // Mermaid will display two edges in either direction, even using
        // the `---` edge type. So we need to deduplicate them.
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

        // Collect all edges to deduplicate them.
        let mut edges = IndexMap::default();
        for artifact in self.map.values() {
            let source_id = *stable_id_map.get(&artifact.id()).unwrap();
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
                let target_id = *stable_id_map.get(&target_id).unwrap();
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
        // This maps unstable duplicate segment source IDs to canonical source
        // IDs.
        let mut source_remap = AHashMap::<NodeId, NodeId>::default();
        for node_ids in duplicate_nodes.values() {
            if node_ids.len() < 2 {
                // We have a singleton like: Node:1 -> [1]
                continue;
            }

            // The duplicate segment nodes are visually indistinguishable, but
            // their outgoing adjacency sets are still meaningful. Sort those
            // adjacency signatures and assign them back to the lowest Mermaid
            // node IDs so equivalent engine output produces the same text
            // without globally reordering the graph.
            let mut signatures = node_ids
                .iter()
                .map(|source_id| {
                    // Build a sorted list of all outgoing edges from this
                    // duplicate source segment, using the target's
                    // neighborhood-aware key.
                    let mut semantic_edge_signature = edges
                        .iter()
                        .filter_map(|((edge_source_id, target_id), edge)| {
                            if edge_source_id != source_id {
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

                    // Some generated region segments have the same source
                    // range and the same semantic edge neighborhood. In that
                    // rare tie, use the existing Mermaid target IDs as a
                    // stable local tie-breaker rather than changing the whole
                    // graph order.
                    //
                    // This case can happen when the geometry is symmetric
                    // enough that two duplicate generated segment nodes are
                    // genuinely indistinguishable at the semantic neighborhood
                    // level.
                    let mut target_id_edge_signature = edges
                        .iter()
                        .filter_map(|((edge_source_id, target_id), edge)| {
                            if edge_source_id != source_id {
                                return None;
                            }
                            Some(format!(
                                "{}|{:?}|{:?}|{:?}",
                                target_id, edge.direction, edge.flow, edge.kind
                            ))
                        })
                        .collect::<Vec<_>>();
                    target_id_edge_signature.sort();

                    (
                        *source_id,
                        semantic_edge_signature.join(","),
                        target_id_edge_signature.join(","),
                    )
                })
                .collect::<Vec<_>>();

            // Sort by:
            //
            // 1. First: semantic neighborhood signature.
            // 2. Then: target ID edge signature.
            // 3. Finally: original source ID.
            //
            // So target IDs are only used when the semantic description cannot
            // distinguish two duplicate segment nodes. At that point, the nodes
            // are semantically indistinguishable for the Mermaid graph.
            signatures.sort_by(|a, b| a.1.cmp(&b.1).then(a.2.cmp(&b.2)).then(a.0.cmp(&b.0)));

            for (canonical_source_id, (source_id, _, _)) in node_ids.iter().copied().zip(signatures) {
                source_remap.insert(source_id, canonical_source_id);
            }
        }
        // Up until now, edges are sorted numerically. Do the remapping.
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

        // Since we're using `node_key`, this does not group arbitrary walls
        // together. It only groups edges that are identical after treating
        // duplicate segment nodes as interchangeable.
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
        // Handles permutation cases where the same number of duplicate sources
        // and duplicate targets can be paired deterministically.
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

            // If two edges share a source or share a target, we do nothing.
            // That avoids incorrectly rewriting many-to-one or one-to-many
            // relationships.
            if source_ids.len() != group.len() || target_ids.len() != group.len() {
                continue;
            }

            // Rewrite the edge pairing. This sorts the affected edges by
            // current source ID, then pairs sorted source IDs with sorted
            // target IDs.
            //
            // If one run produces:
            //
            // ```text
            // 8 -> 27
            // 9 -> 21
            // ```
            //
            // and another run produces:
            //
            // ```text
            // 8 -> 21
            // 9 -> 27
            // ```
            //
            // but those edges are equivalent under `node_key`, this pass
            // normalizes them to the same sorted pairing.
            let mut group = group.clone();
            group.sort_by_key(|index| edges[*index].0.0);
            for (index, (source_id, target_id)) in group.into_iter().zip(source_ids.into_iter().zip(target_ids)) {
                edges[index].0 = (source_id, target_id);
            }
        }

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
