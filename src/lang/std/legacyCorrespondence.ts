import type { EntityReference } from '@kittycad/lib'
import type { ArtifactGraph, SourceRange } from '@src/lang/wasm'
import {
  getCodeRefsByArtifactId,
  getArtifactOfTypes,
  getOriginalSegmentArtifact,
  getSweepFromSuspectedSweepSurface,
  getCapCodeRef,
  getSolid2dCodeRef,
} from '@src/lang/std/artifactGraph'
import { err } from '@src/lib/trap'

// Legacy policy remains deliberately unchanged while new consumers adopt explicit relationship policies.
/**
 * Get code references from an EntityReference by traversing the artifact graph.
 * For edges: finds the two faces, then finds their corresponding wall/cap artifacts,
 * then finds the segments those walls correspond to.
 * For faces: finds the wall/cap artifact and its corresponding segment.
 * For vertices: similar traversal through faces.
 */
export function getCodeRefsFromEntityReference(
  entityRef: EntityReference,
  artifactGraph: ArtifactGraph
): Array<{ range: SourceRange }> | null {
  const codeRefs: Array<{ range: SourceRange }> = []

  if (entityRef.type === 'annotation') {
    const refs = getCodeRefsByArtifactId(entityRef.annotation_id, artifactGraph)
    if (refs?.length) codeRefs.push({ range: refs[0].range })
  } else if (entityRef.type === 'helix' && entityRef.helix_id) {
    const refs = getCodeRefsByArtifactId(entityRef.helix_id, artifactGraph)
    if (refs?.length) codeRefs.push({ range: refs[0].range })
  } else if (entityRef.type === 'segment' && entityRef.segment_id) {
    const segmentRefs = getCodeRefsByArtifactId(
      entityRef.segment_id,
      artifactGraph
    )
    if (segmentRefs && segmentRefs.length > 0) {
      codeRefs.push({ range: segmentRefs[0].range })
    }
  } else if (entityRef.type === 'solid2d' && entityRef.solid2d_id) {
    // For solid2d, get the codeRef directly from the artifact
    const solid2dArtifact = artifactGraph.get(entityRef.solid2d_id)
    if (!solid2dArtifact || solid2dArtifact.type !== 'solid2d') {
      return null
    }
    const codeRefsForSolid2d = getCodeRefsByArtifactId(
      entityRef.solid2d_id,
      artifactGraph
    )
    if (codeRefsForSolid2d && codeRefsForSolid2d.length > 0) {
      codeRefs.push({ range: codeRefsForSolid2d[0].range })
    }
  } else if (entityRef.type === 'solid3d' && entityRef.solid3d_id) {
    // For solid3d, get the codeRef directly from the artifact
    const solid3dArtifact = artifactGraph.get(entityRef.solid3d_id)
    if (
      !solid3dArtifact ||
      (solid3dArtifact.type !== 'sweep' &&
        solid3dArtifact.type !== 'compositeSolid')
    ) {
      return null
    }
    const codeRefsForSolid3d = getCodeRefsByArtifactId(
      entityRef.solid3d_id,
      artifactGraph
    )
    if (codeRefsForSolid3d && codeRefsForSolid3d.length > 0) {
      codeRefs.push({ range: codeRefsForSolid3d[0].range })
    }
  } else if (entityRef.type === 'face' && entityRef.face_id) {
    // For faces, find the wall/cap artifact and traverse to segment
    const faceArtifact = artifactGraph.get(entityRef.face_id)
    if (!faceArtifact) {
      return null
    }

    if (faceArtifact.type === 'edgeCut') {
      return getCodeRefsByArtifactId(faceArtifact.id, artifactGraph)
    }

    // Wall artifacts have segId pointing to the segment
    if (faceArtifact.type === 'wall' && faceArtifact.segId) {
      const segArtifact = getArtifactOfTypes(
        { key: faceArtifact.segId, types: ['segment'] },
        artifactGraph
      )
      if (!err(segArtifact) && segArtifact.codeRef) {
        codeRefs.push({ range: segArtifact.codeRef.range })
        const originalSegment = getOriginalSegmentArtifact(
          segArtifact.id,
          artifactGraph
        )
        if (
          originalSegment &&
          originalSegment.id !== segArtifact.id &&
          originalSegment.codeRef
        ) {
          codeRefs.push({ range: originalSegment.codeRef.range })
        }
      }
      // Also get the extrude (sweep) codeRef, like getCodeRefsByArtifactId does
      const extrusion = getSweepFromSuspectedSweepSurface(
        entityRef.face_id,
        artifactGraph
      )
      if (!err(extrusion) && extrusion.codeRef) {
        codeRefs.push({ range: extrusion.codeRef.range })
      }
    }
    // Cap artifacts - get both the cap codeRef and the extrude
    else if (faceArtifact.type === 'cap') {
      const capCodeRef = getCapCodeRef(faceArtifact, artifactGraph)
      if (!err(capCodeRef)) {
        codeRefs.push({ range: capCodeRef.range })
      }
      // Also get the extrude (sweep) codeRef
      const extrusion = getSweepFromSuspectedSweepSurface(
        entityRef.face_id,
        artifactGraph
      )
      if (!err(extrusion) && extrusion.codeRef) {
        codeRefs.push({ range: extrusion.codeRef.range })
      }
    }
  } else if (entityRef.type === 'solid2d_edge' && entityRef.edge_id) {
    // Solid2D edge ids normally map directly to segment artifacts. Prefer the
    // exact segment before falling back to broader path/profile ranges.
    const segmentArtifact = artifactGraph.get(entityRef.edge_id)
    if (
      segmentArtifact &&
      segmentArtifact.type === 'segment' &&
      segmentArtifact.codeRef
    ) {
      codeRefs.push(segmentArtifact.codeRef)
    }
    // For Solid2D edges (segment curves), the edge_id is the curve UUID
    // We need to find which segment this curve belongs to
    // Search through all paths with solid2dId to find the matching segment
    for (const [_pathId, pathArtifact] of artifactGraph.entries()) {
      if (codeRefs.length > 0) {
        break
      }
      if (pathArtifact.type === 'path' && pathArtifact.solid2dId) {
        // Check all segments in this path
        if (pathArtifact.segIds) {
          for (const segId of pathArtifact.segIds) {
            const segArtifact = artifactGraph.get(segId)
            if (
              segArtifact &&
              segArtifact.type === 'segment' &&
              segArtifact.codeRef
            ) {
              // For now, we'll highlight the segment if the edgeId matches
              // In the future, we could match the curve UUID more precisely
              // But for Solid2D edges, highlighting the whole profile is acceptable
              codeRefs.push({ range: segArtifact.codeRef.range })
            }
          }
        }
        // Also check if the edgeId matches the path or solid2d ID
        const solid2d = artifactGraph.get(pathArtifact.solid2dId)
        if (solid2d && solid2d.type === 'solid2d') {
          const solid2dCodeRef = getSolid2dCodeRef(solid2d, artifactGraph)
          if (!err(solid2dCodeRef)) {
            codeRefs.push({ range: solid2dCodeRef.range })
          }
        }
        break // Found the path, no need to continue
      }
    }
  } else if (
    entityRef.type === 'edge' &&
    entityRef.side_faces &&
    entityRef.side_faces.length >= 1
  ) {
    // For edges, find segments from side_faces and end_faces
    // Handle both Solid3D (2+ faces) and Solid2D (1 face) cases
    const faceIds = [...entityRef.side_faces]
    // Also include end faces
    if (entityRef.end_faces && entityRef.end_faces.length > 0) {
      faceIds.push(...entityRef.end_faces)
    }
    const seenSegments = new Set<string>()

    for (const faceId of faceIds) {
      const faceArtifact = artifactGraph.get(faceId)
      if (!faceArtifact) {
        continue
      }

      // For Solid2D: face is directly a solid2d artifact
      if (faceArtifact.type === 'solid2d') {
        // Get codeRef from the solid2d artifact
        const solid2dCodeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
        if (solid2dCodeRefs && solid2dCodeRefs.length > 0) {
          codeRefs.push({ range: solid2dCodeRefs[0].range })
        }
        // If we have an index, we could potentially highlight the specific curve/segment
        // but for now, highlighting the whole profile is acceptable
      }
      // Wall artifacts have segId pointing to the segment
      else if (faceArtifact.type === 'wall' && faceArtifact.segId) {
        if (!seenSegments.has(faceArtifact.segId)) {
          seenSegments.add(faceArtifact.segId)
          const segArtifact = getArtifactOfTypes(
            { key: faceArtifact.segId, types: ['segment'] },
            artifactGraph
          )
          if (!err(segArtifact) && segArtifact.codeRef) {
            codeRefs.push({ range: segArtifact.codeRef.range })
          }
        }
        // For edges, don't include the extrude - only highlight the segments
        // (The extrude highlighting is only for face hover, not edge hover)
      }
      // Cap artifacts - for edges, only highlight the cap, not the extrude
      else if (faceArtifact.type === 'cap') {
        const capCodeRef = getCapCodeRef(faceArtifact, artifactGraph)
        if (!err(capCodeRef)) {
          codeRefs.push({ range: capCodeRef.range })
        }
        // For edges, don't include the extrude - only highlight the cap
        // (The extrude highlighting is only for face hover, not edge hover)
      }
    }
  } else if (
    entityRef.type === 'vertex' &&
    entityRef.side_faces &&
    entityRef.side_faces.length >= 3
  ) {
    // For vertices, find segments from all adjacent faces (typically 3+)
    const faceIds = [...entityRef.side_faces]
    const seenSegments = new Set<string>()

    for (const faceId of faceIds) {
      const faceArtifact = artifactGraph.get(faceId)
      if (!faceArtifact) {
        continue
      }

      if (faceArtifact.type === 'wall' && faceArtifact.segId) {
        if (!seenSegments.has(faceArtifact.segId)) {
          seenSegments.add(faceArtifact.segId)
          const segArtifact = getArtifactOfTypes(
            { key: faceArtifact.segId, types: ['segment'] },
            artifactGraph
          )
          if (!err(segArtifact) && segArtifact.codeRef) {
            codeRefs.push({ range: segArtifact.codeRef.range })
          }
        }
        // For vertices (like edges), don't include the extrude - only highlight the segments
        // (The extrude highlighting is only for face hover, not vertex hover)
      } else if (faceArtifact.type === 'cap') {
        const capCodeRef = getCapCodeRef(faceArtifact, artifactGraph)
        if (!err(capCodeRef)) {
          codeRefs.push({ range: capCodeRef.range })
        }
        // For vertices (like edges), don't include the extrude - only highlight the cap
        // (The extrude highlighting is only for face hover, not vertex hover)
      }
    }
  }

  return codeRefs.length > 0 ? codeRefs : null
}
