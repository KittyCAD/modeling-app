//! Tests for the artifact graph that convert it to Mermaid diagrams.
use std::fmt::Write;

use super::*;

type NodeId = u32;

type Edges = IndexMap<(NodeId, NodeId), EdgeInfo>;

#[derive(Debug, Clone, PartialEq, Eq)]
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
            Artifact::Path(a) => vec![a.plane_id],
            Artifact::Segment(a) => vec![a.path_id],
            Artifact::Solid2d(a) => vec![a.path_id],
            Artifact::StartSketchOnFace(a) => vec![a.face_id],
            Artifact::StartSketchOnPlane(a) => vec![a.plane_id],
            Artifact::Sweep(a) => vec![a.path_id],
            Artifact::Wall(a) => vec![a.seg_id, a.sweep_id],
            Artifact::Cap(a) => vec![a.sweep_id],
            Artifact::SweepEdge(a) => vec![a.seg_id, a.sweep_id],
            Artifact::EdgeCut(a) => vec![a.consumed_edge_id],
            Artifact::EdgeCutEdge(a) => vec![a.edge_cut_id],
            Artifact::Helix(a) => a.axis_id.map(|id| vec![id]).unwrap_or_default(),
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
                ids
            }
            Artifact::Plane(a) => a.path_ids.clone(),
            Artifact::Path(a) => {
                // Note: Don't include these since they're parents: plane_id.
                let mut ids = a.seg_ids.clone();
                if let Some(sweep_id) = a.sweep_id {
                    ids.push(sweep_id);
                }
                if let Some(solid2d_id) = a.solid2d_id {
                    ids.push(solid2d_id);
                }
                if let Some(composite_solid_id) = a.composite_solid_id {
                    ids.push(composite_solid_id);
                }
                ids
            }
            Artifact::Segment(a) => {
                // Note: Don't include these since they're parents: path_id.
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
            Artifact::StartSketchOnFace { .. } => {
                // Note: Don't include these since they're parents: face_id.
                Vec::new()
            }
            Artifact::StartSketchOnPlane { .. } => {
                // Note: Don't include these since they're parents: plane_id.
                Vec::new()
            }
            Artifact::Sweep(a) => {
                // Note: Don't include these since they're parents: path_id.
                let mut ids = Vec::new();
                ids.extend(&a.surface_ids);
                ids.extend(&a.edge_ids);
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
            Artifact::Helix(_) => {
                // Note: Don't include these since they're parents: axis_id.
                Vec::new()
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
        let mut stable_id_map = FnvHashMap::default();

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
        stable_id_map: &FnvHashMap<ArtifactId, NodeId>,
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
                Artifact::StartSketchOnFace { .. }
                | Artifact::StartSketchOnPlane { .. }
                | Artifact::Sweep(_)
                | Artifact::Wall(_)
                | Artifact::Cap(_)
                | Artifact::SweepEdge(_)
                | Artifact::EdgeCut(_)
                | Artifact::EdgeCutEdge(_)
                | Artifact::Helix(_) => false,
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
                if !code_ref.range.module_id().is_top_level() {
                    // This is pointing to another module. We don't care about
                    // these. It's okay that it's missing, for now.
                    return Ok(());
                }
                return writeln!(output, "{prefix}  %% {label}Missing NodePath");
            }
            writeln!(output, "{prefix}  %% {label}{:?}", code_ref.node_path.steps)
        }

        match artifact {
            Artifact::CompositeSolid(composite_solid) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"CompositeSolid {:?}<br>{:?}\"]",
                    composite_solid.sub_type,
                    code_ref_display(&composite_solid.code_ref)
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
                writeln!(
                    output,
                    "{prefix}{id}[\"Path<br>{:?}\"]",
                    code_ref_display(&path.code_ref)
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
            Artifact::Sweep(sweep) => {
                writeln!(
                    output,
                    "{prefix}{id}[\"Sweep {:?}<br>{:?}\"]",
                    sweep.sub_type,
                    code_ref_display(&sweep.code_ref)
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
                    "{prefix}{id}[\"Helix<br>{:?}\"]",
                    code_ref_display(&helix.code_ref)
                )?;
                node_path_display(output, prefix, None, &helix.code_ref)?;
            }
        }
        Ok(())
    }

    fn flowchart_edges<W: Write>(
        &self,
        output: &mut W,
        stable_id_map: &FnvHashMap<ArtifactId, NodeId>,
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

        // Output the edges.
        edges.par_sort_by(|ak, _, bk, _| (if ak.0 == bk.0 { ak.1.cmp(&bk.1) } else { ak.0.cmp(&bk.0) }));
        for ((source_id, target_id), edge) in edges {
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
