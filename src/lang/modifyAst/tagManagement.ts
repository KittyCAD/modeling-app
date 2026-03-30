/**
 * Little Kingdom of Tags
 * ======================
 *
 * This module provides a system for working with tags.
 * Tags are used to reference parts of geometry for operations like:
 * - Edge treatments (fillets, chamfers)
 * - Feature operations (extrude, revolve)
 * - Boolean operations (union, difference, intersection)
 *
 * The system is organized in three layers:
 * 1. High-level: Entry points for tag operations
 * 2. Mid-level: Selection-specific tagging operations
 * 3. Low-level: Building blocks for tag manipulation
 */

import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
  createMemberExpression,
  createTagDeclarator,
  findUniqueName,
} from '@src/lang/create'
import {
  getNodeFromPath,
  getEdgeCutMeta,
  getSketchSegmentName,
  isSketchSegmentCallName,
} from '@src/lang/queryAst'
import type {
  Artifact,
  ResolvedGraphSelection,
} from '@src/lang/std/artifactGraph'
import {
  getArtifactOfTypes,
  getCommonFacesForEdge,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import {
  addTagForSketchOnFace,
  isTaggableSketchSegment,
} from '@src/lang/std/sketchTaggingHelpers'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import type { EdgeCutInfo } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import { capitaliseFC } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

// ==============================================
// SECTION 1: PUBLIC TAG ENTRY POINTS
// ==============================================

/**
 * Primary entry point for adding tags to any selection
 * This function handles different selection types directly based on artifact type
 *
 * @param ast Current AST to modify
 * @param selection User's selection (edge, face, etc.)
 * @param artifactGraph Artifact graph for resolving relationships
 * @returns Modified AST and created tag(s)
 */
export function modifyAstWithTagsForSelection(
  ast: Node<Program>,
  selection: ResolvedGraphSelection,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType,
  tagMethods?: string[]
): { modifiedAst: Node<Program>; exprs: Expr[] } | Error {
  if (!selection.artifact) {
    return new Error('Selection does not have an artifact')
  }

  // ----------------------------------------
  // 2D Entities
  // ----------------------------------------

  // TODO: Add handling for PLANE selections (2D construction planes)

  // ----------------------------------------
  // Sketch Entities
  // ----------------------------------------

  // TODO: Add handling for POINT selections (sketch points)
  // TODO: Add handling for CURVE selections (lines, arcs, splines)
  // TODO: Add handling for SKETCH selections (entire sketches)

  // ----------------------------------------
  // Body Entities
  // ----------------------------------------

  // TODO: Add handling for VERTEX selections

  // Handle EDGE selections (segment only). EdgeCut is a face (chamfer/fillet produce a face), not an edge.
  if (selection.artifact.type === 'segment') {
    return modifyAstWithTagsForEdgeSelection(
      ast,
      selection,
      artifactGraph,
      wasmInstance,
      tagMethods
    )
  }

  // Handle FACE selections (wall, cap, edgeCut). EdgeCut = chamfer/fillet face.
  if (
    selection.artifact.type === 'wall' ||
    selection.artifact.type === 'cap' ||
    selection.artifact.type === 'edgeCut'
  ) {
    const result = modifyAstWithTagForFaceSelection(
      ast,
      selection,
      artifactGraph,
      wasmInstance
    )
    if (err(result)) return result
    return {
      modifiedAst: result.modifiedAst,
      exprs: [result.expr],
    }
  }

  // TODO: Add handling for BODY selections (volumes)

  // Unsupported selection type
  return new Error(`Unsupported selection type: ${selection.artifact.type}`)
}

/**
 * Creates a labeled argument containing tag expressions
 * for use in feature operations
 *
 * This function makes assumptions based on tag count:
 * - If an array contains 2+ tags: Assumes it's an edge
 *   defined by faces, creates a getCommonEdge expression
 * - If an array contains 1 tag: Assumes
 *   it's a face or body, uses the tag directly
 *
 * LIMITATIONS:
 * - Relies on tag count rather than geometric understanding
 *
 * @param tagInfos Array of objects with tags property (e.g. [{tags: ['tag1', 'tag2']}, ...])
 * @param paramName Name for the labeled argument (e.g. 'tags', 'axis', 'tools')
 * @returns Labeled argument containing the appropriate tag expressions
 */
export function createTagExpressions(
  tagInfos: Array<{ tags: string[]; artifact: Artifact }>,
  tagMethods?: string[]
): Expr[] {
  // Map each tag array to the appropriate expression
  const expressions = tagInfos.map(({ tags, artifact }) => {
    // ----------------------------------------
    // 2D Entities
    // ----------------------------------------

    // TODO: Add handling for PLANE selections (2D construction planes)

    // ----------------------------------------
    // Sketch Entities
    // ----------------------------------------

    // TODO: Add handling for POINT selections (sketch points)
    // TODO: Add handling for CURVE selections (lines, arcs, splines)
    // TODO: Add handling for SKETCH selections (entire sketches)

    // ----------------------------------------
    // Body Entities
    // ----------------------------------------

    // Handle EDGE selections (segment only). EdgeCut is a face.
    if (artifact.type === 'segment') {
      // Default: get common edge of 2 faces scenario
      if (!tagMethods || !tagMethods.includes('oppositeAndAdjacentEdges')) {
        return createCallExpressionStdLibKw('getCommonEdge', null, [
          createLabeledArg(
            'faces',
            createArrayExpression(tags.map((tag) => createLocalName(tag)))
          ),
        ])
      }
      // oppositeAndAdjacentEdges: use tag directly
      return createLocalName(tags[0])
    }

    // Handle FACE selections (wall, cap, edgeCut)
    else if (
      artifact.type === 'wall' ||
      artifact.type === 'cap' ||
      artifact.type === 'edgeCut'
    ) {
      // Face tags are referenced directly
      return createLocalName(tags[0])
    }
    // TODO: Add handling for BODY selections (volumes)

    // All other types - handle as direct references
    return createLocalName(tags[0])
  })

  return expressions
}

// ==============================================
// SECTION 2: SELECTION TYPE HANDLERS
// ==============================================

/**
 * Handles edge selection by finding the common faces and tagging both
 * An edge is defined by two intersecting faces, so this tags both faces
 *
 * @param ast Current AST to modify
 * @param selection Edge selection
 * @param artifactGraph Artifact graph for resolving relationships
 * @returns Modified AST and the created tags (typically 2 for an edge)
 */
function modifyAstWithTagsForEdgeSelection(
  ast: Node<Program>,
  selection: ResolvedGraphSelection,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType,
  tagMethods?: string[]
): { modifiedAst: Node<Program>; exprs: Expr[] } | Error {
  const artifact = selection.artifact
  if (!artifact || artifact.type !== 'segment') {
    return new Error(
      'Selection artifact is not a valid edge type (segment only)'
    )
  }

  const segmentArtifact = artifact

  let astClone = structuredClone(ast)
  const exprs: Expr[] = []

  // Default: get common edge of 2 faces scenario
  if (!tagMethods || !tagMethods.includes('oppositeAndAdjacentEdges')) {
    // Get the common faces that form this edge
    const commonFaceArtifacts = getCommonFacesForEdge(
      segmentArtifact,
      artifactGraph
    )
    if (err(commonFaceArtifacts)) return commonFaceArtifacts

    // Apply tagging to each face that forms this edge
    for (const faceArtifact of commonFaceArtifacts) {
      // Create a face selection from the face artifact
      const faceSelection: ResolvedGraphSelection = {
        ...selection,
        artifact: faceArtifact,
      }

      // Tag the face with destructuring
      const result = modifyAstWithTagForFaceSelection(
        astClone,
        faceSelection,
        artifactGraph,
        wasmInstance
      )
      if (err(result)) return result

      // Update AST and collect tag using destructuring
      const { modifiedAst, expr } = result
      astClone = modifiedAst
      exprs.push(expr)
    }

    return {
      modifiedAst: astClone,
      exprs,
    }
  }
  // get opposite and adjacent edges scenario
  else if (tagMethods && tagMethods.includes('oppositeAndAdjacentEdges')) {
    // Get path to sweep
    const sweepArtifact = getSweepArtifactFromSelection(
      selection,
      artifactGraph
    )
    if (err(sweepArtifact)) return sweepArtifact

    // Get path to segment
    const pathToSegmentNode = selection.codeRef?.pathToNode
    if (!pathToSegmentNode) {
      return new Error('Selection has no codeRef pathToNode')
    }

    const segmentNode = getNodeFromPath<CallExpressionKw>(
      astClone,
      pathToSegmentNode,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(segmentNode)) return segmentNode

    // Check whether selection is a valid segment
    if (segmentNode.node.type !== 'CallExpressionKw') {
      return new Error('Selection segment node not found or wrong type', {
        cause: segmentNode,
      })
    }
    if (!isTaggableSketchSegment(segmentNode.node.callee.name.name)) {
      return new Error('Selection is not a sketch segment')
    }

    // Add tag to the sketch segment or use existing tag
    const taggedSegment = addTagForSketchOnFace(
      {
        pathToNode: pathToSegmentNode,
        node: astClone,
        wasmInstance,
      },
      segmentNode.node.callee.name.name,
      null,
      wasmInstance
    )
    if (err(taggedSegment)) return taggedSegment
    const { tag } = taggedSegment
    exprs.push(createLocalName(tag))

    return {
      modifiedAst: astClone,
      exprs,
    }
  }

  // Unsupported selection type
  return new Error(
    `Unsupported selection type: ${selection.artifact?.type ?? 'undefined'}`
  )
}

/**
 * Adds appropriate tags to AST nodes based on a face selection
 *
 * @param ast Current AST to modify
 * @param selection User's face selection
 * @param artifactGraph Artifact graph for resolving relationships
 * @returns Modified AST and the created tag
 */
function modifyAstWithTagForFaceSelection(
  ast: Node<Program>,
  selection: ResolvedGraphSelection,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): { modifiedAst: Node<Program>; expr: Expr } | Error {
  if (!selection.artifact) {
    return new Error('Selection does not have an artifact')
  }

  // CASE 1: Handle wall face - tag the sketch segment
  if (selection.artifact.type === 'wall') {
    // Each handler function creates its own clone and returns a new AST
    const result = modifyAstWithTagForWallFace(
      ast,
      selection.artifact,
      artifactGraph,
      wasmInstance
    )
    if (err(result)) return result
    const { modifiedAst, expr } = result
    return {
      modifiedAst: modifiedAst,
      expr,
    }
  }
  // CASE 2: Handle cap face - tag the extrusion/sweep (mutates ast in place)
  else if (selection.artifact.type === 'cap') {
    const result = modifyAstWithTagForCapFace(
      ast,
      selection.artifact,
      artifactGraph,
      wasmInstance
    )
    if (err(result)) return result
    return {
      modifiedAst: ast,
      expr: createLocalName(result.tag),
    }
  }
  // CASE 3: Handle edgeCut face - tag the underlying segment
  else if (selection.artifact.type === 'edgeCut') {
    // Each handler function creates its own clone and returns a new AST
    const result = modifyAstWithTagForEdgeCutFace(
      ast,
      selection.artifact,
      artifactGraph,
      wasmInstance
    )
    if (err(result)) return result
    const { modifiedAst, tag } = result
    return {
      modifiedAst: modifiedAst,
      expr: createLocalName(tag),
    }
  } else {
    return new Error(`Unsupported artifact type: ${selection.artifact.type}`)
  }
}

// ==============================================
// SECTION 3: ENTITY-SPECIFIC TAGGING UTILITIES
// ==============================================

/**
 * Tags a wall face by finding its underlying sketch segment
 *
 * @param ast AST to modify
 * @param wallFace Wall face artifact
 * @param artifactGraph Artifact graph
 * @returns Modified AST and created tag
 */
function modifyAstWithTagForWallFace(
  ast: Node<Program>,
  wallFace: Artifact,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): { modifiedAst: Node<Program>; expr: Expr } | Error {
  if (wallFace.type !== 'wall') {
    return new Error('Selection artifact is not a valid wall type')
  }

  // Clone AST
  const astClone = structuredClone(ast)

  // Get the segment from wall face
  const segment = getArtifactOfTypes(
    { key: wallFace.segId, types: ['segment'] },
    artifactGraph
  )
  if (err(segment)) return segment

  const pathToSegmentNode = segment.codeRef.pathToNode

  // No tag path: just retrieve the sketch block segment
  if (segment.originalSegId && segment.originalSegId !== segment.id) {
    const region = getNodeFromPath<VariableDeclaration>(
      astClone,
      segment.codeRef.pathToNode,
      wasmInstance,
      'VariableDeclaration'
    )
    if (
      !err(region) &&
      region.node.type === 'VariableDeclaration' &&
      region.node.declaration.init.type === 'CallExpressionKw' &&
      region.node.declaration.init.callee.name.name === 'region'
    ) {
      const regionName = region.node.declaration.id.name
      const originalSegName = getSketchSegmentName(
        astClone,
        segment.originalSegId,
        artifactGraph,
        wasmInstance
      )
      if (originalSegName) {
        return {
          modifiedAst: astClone,
          expr: createMemberExpression(
            createMemberExpression(regionName, 'tags'),
            originalSegName
          ),
        }
      }
    }
  }

  const result = modifyAstWithTagForSketchSegment(
    astClone,
    pathToSegmentNode,
    wasmInstance
  )
  if (err(result)) return result
  const { modifiedAst, tag } = result

  return {
    modifiedAst: modifiedAst,
    expr: createLocalName(tag),
  }
}

/**
 * Tags a cap face (end of extrude) by modifying the sweep call in place.
 * Handles both start and end caps with appropriate tag names (tagEnd/tagStart).
 * Mutates `ast`; use instead of END/START so edit flows can resolve the face.
 *
 * @param ast AST to modify in place
 * @param capFace Cap face artifact
 * @param artifactGraph Artifact graph
 * @returns Created or existing tag name
 */
export function modifyAstWithTagForCapFace(
  ast: Node<Program>,
  capFace: Artifact,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): { tag: string } | Error {
  if (capFace.type !== 'cap') {
    return new Error('Selection artifact is not a valid cap type')
  }

  const sweepArtifact = getArtifactOfTypes(
    { key: capFace.sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (err(sweepArtifact)) return sweepArtifact

  if (
    sweepArtifact.subType !== 'extrusion' &&
    sweepArtifact.subType !== 'revolve' &&
    sweepArtifact.subType !== 'revolveAboutEdge'
  ) {
    return new Error('Only extrusion and revolve caps are currently supported')
  }

  const pathToSweepNode = sweepArtifact.codeRef.pathToNode
  const callExp = getNodeFromPath<CallExpressionKw>(
    ast,
    pathToSweepNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (err(callExp)) return callExp

  const capType = capitaliseFC(capFace.subType)
  const tagParamName = `tag${capType}`

  const existingTag = callExp.node.arguments.find(
    (arg) => arg.label?.name === tagParamName
  )

  if (existingTag && existingTag.arg.type === 'TagDeclarator') {
    return { tag: existingTag.arg.value }
  }

  const newTag = findUniqueName(ast, `cap${capType}`)
  const tagCall = createLabeledArg(tagParamName, createTagDeclarator(newTag))
  callExp.node.arguments.push(tagCall)
  return { tag: newTag }
}

/**
 * Tags a sketch segment in the AST or uses an existing tag if present
 *
 * @param ast AST to modify
 * @param pathToSegmentNode Path to the segment node
 * @returns Modified AST and the tag name
 */
function modifyAstWithTagForSketchSegment(
  ast: Node<Program>,
  pathToSegmentNode: PathToNode,
  wasmInstance: ModuleType
): { modifiedAst: Node<Program>; tag: string } | Error {
  // Clone AST
  const astClone = structuredClone(ast)

  const segmentNode = getNodeFromPath<CallExpressionKw>(
    astClone,
    pathToSegmentNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (err(segmentNode)) return segmentNode

  // Check whether selection is a valid sketch segment
  if (!isSketchSegmentCallName(segmentNode.node.callee.name.name)) {
    return new Error('Selection is not a sketch segment')
  }

  // Add tag to the sketch segment or use existing tag
  const taggedSegment = addTagForSketchOnFace(
    {
      pathToNode: pathToSegmentNode,
      node: astClone,
      wasmInstance,
    },
    segmentNode.node.callee.name.name,
    null,
    wasmInstance
  )
  if (err(taggedSegment)) return taggedSegment
  const { tag } = taggedSegment

  return { modifiedAst: astClone, tag }
}

/**
 * Mutates the AST to add a tag to a sketch segment or chamfer
 *
 * This function adds a tag to sketch line segments (like xLine, yLine, line, arc)
 * or chamfer operations. It validates the target node is a valid segment or chamfer
 * and uses the existing tag if one is present, or creates a new one if needed.
 *
 * Used by various tagging operations that need to reference specific sketch segments,
 * particularly for edge treatments and GDT annotations on chamfered faces.
 *
 * @param astClone The AST to modify (will be mutated)
 * @param pathToSegmentNode Path to the target sketch segment or chamfer node
 * @param edgeCutMeta Optional edge cut metadata for chamfer operations
 * @returns Object with modified AST and the tag name, or Error if invalid
 */
export function mutateAstWithTagForSketchSegment(
  astClone: Node<Program>,
  pathToSegmentNode: PathToNode,
  wasmInstance: ModuleType,
  edgeCutMeta: EdgeCutInfo | null = null
): { modifiedAst: Node<Program>; tag: string } | Error {
  const segmentNode = getNodeFromPath<CallExpressionKw>(
    astClone,
    pathToSegmentNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (err(segmentNode)) return segmentNode

  // Check whether selection is a valid segment
  if (
    !segmentNode.node.callee ||
    !(
      isTaggableSketchSegment(segmentNode.node.callee.name.name) ||
      segmentNode.node.callee.name.name === 'chamfer' ||
      segmentNode.node.callee.name.name === 'fillet'
    )
  ) {
    return new Error('Selection is not a sketch segment, chamfer, or fillet')
  }

  // Add tag to the sketch segment or use existing tag
  // a helper function that creates the updated node and applies the changes to the AST
  const taggedSegment = addTagForSketchOnFace(
    {
      pathToNode: pathToSegmentNode,
      node: astClone,
      wasmInstance,
    },
    segmentNode.node.callee.name.name,
    edgeCutMeta,
    wasmInstance
  )
  if (err(taggedSegment)) return taggedSegment
  const { tag } = taggedSegment

  return { modifiedAst: astClone, tag }
}

/**
 * Handler for edgeCut face selection.
 * Tags the underlying sketch segment that was used to create the edge cut.
 *
 * @param ast - The AST to modify
 * @param edgeCutFace - The edgeCut artifact representing the face
 * @param artifactGraph - The artifact graph for context
 * @returns Modified AST with tag and the tag name, or an Error
 */
function modifyAstWithTagForEdgeCutFace(
  ast: Node<Program>,
  edgeCutFace: Artifact,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): { modifiedAst: Node<Program>; tag: string } | Error {
  if (edgeCutFace.type !== 'edgeCut') {
    return new Error('Selection artifact is not a valid edgeCut type')
  }

  // Clone AST
  const astClone = structuredClone(ast)

  // Get edge cut metadata to understand the underlying segment
  const edgeCutMeta = getEdgeCutMeta(
    edgeCutFace,
    astClone,
    artifactGraph,
    wasmInstance
  )

  // Tag the underlying segment using the edgeCut artifact's codeRef
  const tagResult = mutateAstWithTagForSketchSegment(
    astClone,
    edgeCutFace.codeRef.pathToNode,
    wasmInstance,
    edgeCutMeta
  )
  if (err(tagResult)) return tagResult

  const { modifiedAst, tag } = tagResult
  return { modifiedAst, tag }
}
