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

import type {
  ArtifactGraph,
  CallExpression,
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import {
  createCallExpressionStdLib,
  createArrayExpression,
  createLocalName,
  createCallExpressionStdLibKw,
  createLabeledArg,
  findUniqueName,
  createTagDeclarator,
} from '@src/lang/create'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  addTagForSketchOnFace,
  sketchLineHelperMap,
  sketchLineHelperMapKw,
} from '@src/lang/std/sketch'
import { err } from '@src/lib/trap'
import type { Selection } from '@src/lib/selections'
import { capitaliseFC } from '@src/lib/utils'
import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  getArtifactOfTypes,
  getCommonFacesForEdge,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import type { Node } from '@rust/kcl-lib/bindings/Node'

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
  selection: Selection,
  artifactGraph: ArtifactGraph,
  tagMethods?: string[]
): { modifiedAst: Node<Program>; tags: string[] } | Error {
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

  // Handle EDGE selections
  if (
    selection.artifact.type === 'sweepEdge' ||
    selection.artifact.type === 'segment' //||
    // TODO: selection.artifact.type === 'edgeCutEdge'
  ) {
    const edgeResult = modifyAstWithTagsForEdgeSelection(
      ast,
      selection,
      artifactGraph,
      tagMethods
    )
    if (err(edgeResult)) return edgeResult
    return {
      modifiedAst: edgeResult.modifiedAst,
      tags: edgeResult.tags,
    }
  }

  // Handle FACE selections
  if (
    selection.artifact.type === 'wall' ||
    selection.artifact.type === 'cap' ||
    selection.artifact.type === 'edgeCut'
  ) {
    const result = modifyAstWithTagForFaceSelection(
      ast,
      selection,
      artifactGraph
    )
    if (err(result)) return result
    return {
      modifiedAst: result.modifiedAst,
      tags: [result.tag],
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

    // Handle EDGE selections
    // For edges (2+ tags) - create getCommonEdge (for edges)
    if (artifact.type === 'sweepEdge' || artifact.type === 'segment') {
      // Default: get common edge of 2 faces scenario
      if (!tagMethods || !tagMethods.includes('oppositeAndAdjacentEdges')) {
        return createCallExpressionStdLibKw('getCommonEdge', null, [
          createLabeledArg(
            'faces',
            createArrayExpression(tags.map((tag) => createLocalName(tag)))
          ),
        ])
      }

      // get opposite and adjacent edges scenario
      else if (tagMethods && tagMethods.includes('oppositeAndAdjacentEdges')) {
        const tag = tags[0]
        let tagCall: Expr = createLocalName(tag)

        // Modify the tag based on selectionType
        if (artifact.type === 'sweepEdge' && artifact.subType === 'opposite') {
          tagCall = createCallExpressionStdLib('getOppositeEdge', [tagCall])
        } else if (
          artifact.type === 'sweepEdge' &&
          artifact.subType === 'adjacent'
        ) {
          tagCall = createCallExpressionStdLib('getNextAdjacentEdge', [tagCall])
        }
        return tagCall
      }
    }

    // Handle FACE selections
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
  selection: Selection,
  artifactGraph: ArtifactGraph,
  tagMethods?: string[]
): { modifiedAst: Node<Program>; tags: string[] } | Error {
  if (
    !selection.artifact ||
    (selection.artifact.type !== 'sweepEdge' &&
      selection.artifact.type !== 'segment')
    //TODO: selection.artifact.type !== 'edgeCutEdge'
  ) {
    return new Error('Selection artifact is not a valid edge type')
  }

  let astClone = structuredClone(ast)
  const tags: string[] = []

  // Default: get common edge of 2 faces scenario
  if (!tagMethods || !tagMethods.includes('oppositeAndAdjacentEdges')) {
    // Get the common faces that form this edge
    const commonFaceArtifacts = getCommonFacesForEdge(
      selection.artifact,
      artifactGraph
    )
    if (err(commonFaceArtifacts)) return commonFaceArtifacts

    // Apply tagging to each face that forms this edge
    for (const faceArtifact of commonFaceArtifacts) {
      // Create a face selection from the face artifact
      const faceSelection: Selection = {
        ...selection,
        artifact: faceArtifact,
      }

      // Tag the face with destructuring
      const result = modifyAstWithTagForFaceSelection(
        astClone,
        faceSelection,
        artifactGraph
      )
      if (err(result)) return result

      // Update AST and collect tag using destructuring
      const { modifiedAst, tag } = result
      astClone = modifiedAst
      tags.push(tag)
    }

    return {
      modifiedAst: astClone,
      tags,
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
    const pathToSweepNode = getNodePathFromSourceRange(
      astClone,
      sweepArtifact.codeRef.range
    )
    if (err(pathToSweepNode)) return pathToSweepNode

    // Get path to segment
    const pathToSegmentNode = getNodePathFromSourceRange(
      astClone,
      selection.codeRef.range
    )
    if (err(pathToSegmentNode)) return pathToSegmentNode

    const segmentNode = getNodeFromPath<CallExpression | CallExpressionKw>(
      astClone,
      pathToSegmentNode,
      ['CallExpression', 'CallExpressionKw']
    )
    if (err(segmentNode)) return segmentNode

    // Check whether selection is a valid segment
    if (
      !(
        segmentNode.node.callee.name.name in sketchLineHelperMap ||
        segmentNode.node.callee.name.name in sketchLineHelperMapKw
      )
    ) {
      return new Error('Selection is not a sketch segment')
    }

    // Add tag to the sketch segment or use existing tag
    const taggedSegment = addTagForSketchOnFace(
      {
        pathToNode: pathToSegmentNode,
        node: astClone,
      },
      segmentNode.node.callee.name.name,
      null
    )
    if (err(taggedSegment)) return taggedSegment
    const { tag } = taggedSegment
    tags.push(tag)

    return {
      modifiedAst: astClone,
      tags,
    }
  }

  // Unsupported selection type
  return new Error(`Unsupported selection type: ${selection.artifact.type}`)
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
  selection: Selection,
  artifactGraph: ArtifactGraph
): { modifiedAst: Node<Program>; tag: string } | Error {
  if (!selection.artifact) {
    return new Error('Selection does not have an artifact')
  }

  // CASE 1: Handle wall face - tag the sketch segment
  if (selection.artifact.type === 'wall') {
    // Each handler function creates its own clone and returns a new AST
    const result = modifyAstWithTagForWallFace(
      ast,
      selection.artifact,
      artifactGraph
    )
    if (err(result)) return result
    const { modifiedAst, tag } = result
    return {
      modifiedAst: modifiedAst,
      tag: tag,
    }
  }
  // CASE 2: Handle cap face - tag the extrusion/sweep
  else if (selection.artifact.type === 'cap') {
    // Each handler function creates its own clone and returns a new AST
    const result = modifyAstWithTagForCapFace(
      ast,
      selection.artifact,
      artifactGraph
    )
    if (err(result)) return result
    const { modifiedAst, tag } = result
    return {
      modifiedAst: modifiedAst,
      tag: tag,
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
  artifactGraph: ArtifactGraph
): { modifiedAst: Node<Program>; tag: string } | Error {
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

  const pathToSegmentNode = getNodePathFromSourceRange(
    astClone,
    segment.codeRef.range
  )

  const result = modifyAstWithTagForSketchSegment(astClone, pathToSegmentNode)
  if (err(result)) return result
  const { modifiedAst, tag } = result

  return {
    modifiedAst: modifiedAst,
    tag: tag,
  }
}

/**
 * Tags a cap face (end of extrude) by modifying the sweep call
 * Handles both start and end caps with appropriate tag names
 *
 * @param ast AST to modify
 * @param capFace Cap face artifact
 * @param artifactGraph Artifact graph
 * @returns Modified AST and created tag
 */
function modifyAstWithTagForCapFace(
  ast: Node<Program>,
  capFace: Artifact,
  artifactGraph: ArtifactGraph
): { modifiedAst: Node<Program>; tag: string } | Error {
  if (capFace.type !== 'cap') {
    return new Error('Selection artifact is not a valid cap type')
  }
  // Clone AST
  const astClone = structuredClone(ast)

  // Get the sweep artifact for this cap
  const sweepArtifact = getArtifactOfTypes(
    { key: capFace.sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (err(sweepArtifact)) return sweepArtifact

  // Currently only supporting extrusion
  if (sweepArtifact.subType !== 'extrusion' && sweepArtifact.subType !== 'revolve' && sweepArtifact.subType !== 'revolveAboutEdge') {
    return new Error('Only extrusion and revolve caps are currently supported')
  }

  const pathToSweepNode = getNodePathFromSourceRange(
    astClone,
    sweepArtifact.codeRef.range
  )

  const callExp = getNodeFromPath<CallExpressionKw>(astClone, pathToSweepNode, [
    'CallExpressionKw',
  ])
  if (err(callExp)) return callExp

  // Get the cap type (Start or End)
  const capType = capitaliseFC(capFace.subType)

  // Use the appropriate tag parameter name (tagStart or tagEnd)
  const tagParamName = `tag${capType}`

  // Check for existing tag with this parameter name
  const existingTag = callExp.node.arguments.find(
    (arg) => arg.label.name === tagParamName
  )

  if (existingTag && existingTag.arg.type === 'TagDeclarator') {
    // Use existing tag
    return {
      modifiedAst: astClone,
      tag: existingTag.arg.value,
    }
  } else {
    // Create new tag
    const newTag = findUniqueName(astClone, `cap${capType}`)
    const tagCall = createLabeledArg(tagParamName, createTagDeclarator(newTag))
    callExp.node.arguments.push(tagCall)

    return {
      modifiedAst: astClone,
      tag: newTag,
    }
  }
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
  pathToSegmentNode: PathToNode
): { modifiedAst: Node<Program>; tag: string } | Error {
  // Clone AST
  const astClone = structuredClone(ast)

  const segmentNode = getNodeFromPath<CallExpression | CallExpressionKw>(
    astClone,
    pathToSegmentNode,
    ['CallExpression', 'CallExpressionKw']
  )
  if (err(segmentNode)) return segmentNode

  // Check whether selection is a valid sketch segment
  if (
    !(
      segmentNode.node.callee.name.name in sketchLineHelperMap ||
      segmentNode.node.callee.name.name in sketchLineHelperMapKw
    )
  ) {
    return new Error('Selection is not a sketch segment')
  }

  // Add tag to the sketch segment or use existing tag
  const taggedSegment = addTagForSketchOnFace(
    {
      pathToNode: pathToSegmentNode,
      node: astClone,
    },
    segmentNode.node.callee.name.name,
    null
  )
  if (err(taggedSegment)) return taggedSegment
  const { tag } = taggedSegment

  return { modifiedAst: astClone, tag }
}
