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
  createSketchTagMemberExpression,
  getEdgeCutMeta,
  getNodeFromPath,
  getRegionTagExprFromSegmentId,
  getSketchSegmentNameFromSourceSurface,
  getVariableExprsFromSelection,
  isCallExprWithName,
  isSketchSegmentCallName,
} from '@src/lang/queryAst'
import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  getArtifactOfTypes,
  getArtifactsOfTypes,
  getCommonFacesForEdge,
  getOriginalSegmentArtifact,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import {
  addTagForSketchOnFace,
  sketchLineHelperMapKw,
} from '@src/lang/std/sketch'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { capitaliseFC, isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { EdgeCutInfo, Selection } from '@src/machines/modelingSharedTypes'

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
  wasmInstance: ModuleType,
  optionsOrTagMethods?: ModifyAstWithTagsOptions | string[]
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

  // Handle EDGE selections
  if (
    selection.artifact.type === 'sweepEdge' ||
    selection.artifact.type === 'segment' //||
    // TODO: selection.artifact.type === 'edgeCutEdge'
  ) {
    const options = isArray(optionsOrTagMethods)
      ? { tagMethods: optionsOrTagMethods }
      : optionsOrTagMethods
    return modifyAstWithTagsForEdgeSelection(
      ast,
      selection,
      artifactGraph,
      wasmInstance,
      options
    )
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
      artifactGraph,
      wasmInstance
    )
    if (err(result)) return result
    return {
      modifiedAst: result.modifiedAst,
      exprs: [result.expr],
    }
  }

  if (selection.artifact.type === 'primitiveFace') {
    const variableLookup = getNodeFromPath<VariableDeclaration>(
      ast,
      selection.codeRef.pathToNode,
      wasmInstance,
      'VariableDeclaration',
      false,
      true
    )
    if (
      !(variableLookup instanceof Error) &&
      variableLookup.node.type === 'VariableDeclaration' &&
      isCallExprWithName(variableLookup.node.declaration.init, 'faceId')
    ) {
      return {
        modifiedAst: ast,
        exprs: [createLocalName(variableLookup.node.declaration.id.name)],
      }
    }

    const directLookup = getNodeFromPath<Node<CallExpressionKw>>(
      ast,
      selection.codeRef.pathToNode,
      wasmInstance,
      'CallExpressionKw',
      false,
      true
    )
    if (err(directLookup)) {
      return directLookup
    }
    const node = directLookup.node
    if (!isCallExprWithName(node, 'faceId')) {
      return new Error('Failed to retrieve primitive face')
    }
    return {
      modifiedAst: ast,
      exprs: [structuredClone(node)],
    }
  }

  // TODO: Add handling for BODY selections (volumes)

  // Unsupported selection type
  return new Error(`Unsupported selection type: ${selection.artifact.type}`)
}

export type EdgeSelectionContext = {
  sourceSweep: Extract<Artifact, { type: 'sweep' }>
  selectedBodyExpr: Expr
  bodyKey: string
  pathIfPipe?: PathToNode
  isClone?: boolean
}

export type ModifyAstWithTagsOptions = {
  tagMethods?: string[]
  edgeContext?: EdgeSelectionContext
  nodeToEdit?: PathToNode
}

function getEdgeBodyKey(selectedBodyExpr: Expr, pathIfPipe?: PathToNode) {
  return JSON.stringify([selectedBodyExpr, pathIfPipe])
}

export function resolveEdgeSelectionContext(
  ast: Node<Program>,
  selection: Selection,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode,
  lastChildLookup = true
): EdgeSelectionContext | Error {
  if (
    selection.artifact?.type !== 'sweepEdge' &&
    selection.artifact?.type !== 'segment'
  ) {
    return new Error('Selection artifact is not a valid edge type')
  }

  const sourceSweepResult = getSweepArtifactFromSelection(
    selection,
    artifactGraph
  )
  if (err(sourceSweepResult)) return sourceSweepResult
  const sourceSweep = sourceSweepResult as Extract<Artifact, { type: 'sweep' }>

  const segment =
    selection.artifact.type === 'segment'
      ? selection.artifact
      : getArtifactOfTypes(
          { key: selection.artifact.segId, types: ['segment'] },
          artifactGraph
        )
  if (!err(segment)) {
    const selectedPath = getArtifactOfTypes(
      { key: segment.pathId, types: ['path'] },
      artifactGraph
    )
    if (!err(selectedPath) && selectedPath.id !== sourceSweep.pathId) {
      const cloneCall = getNodeFromPath<CallExpressionKw>(
        ast,
        selectedPath.codeRef.pathToNode,
        wasmInstance,
        'CallExpressionKw'
      )
      if (!err(cloneCall) && isCallExprWithName(cloneCall.node, 'clone')) {
        const cloneVariable = getVariableExprsFromSelection(
          {
            graphSelections: [
              {
                artifact: selectedPath,
                codeRef: selectedPath.codeRef,
              },
            ],
            otherSelections: [],
          },
          artifactGraph,
          ast,
          wasmInstance,
          nodeToEdit
        )
        if (err(cloneVariable)) return cloneVariable
        if (cloneVariable.exprs.length !== 1) {
          return new Error('Could not resolve the selected clone body')
        }
        const selectedBodyExpr = cloneVariable.exprs[0]
        return {
          sourceSweep,
          selectedBodyExpr,
          bodyKey: getEdgeBodyKey(selectedBodyExpr, cloneVariable.pathIfPipe),
          pathIfPipe: cloneVariable.pathIfPipe,
          isClone: true,
        }
      }
    }
  }

  const body = getVariableExprsFromSelection(
    {
      graphSelections: [
        {
          artifact: sourceSweep,
          codeRef: sourceSweep.codeRef,
        },
      ],
      otherSelections: [],
    },
    artifactGraph,
    ast,
    wasmInstance,
    nodeToEdit,
    {
      lastChildLookup,
      artifactTypeFilter: ['compositeSolid', 'sweep'],
    }
  )
  if (err(body)) return body
  if (body.exprs.length !== 1) {
    return new Error('Could not resolve the selected edge body')
  }

  return {
    sourceSweep,
    selectedBodyExpr: body.exprs[0],
    bodyKey: getEdgeBodyKey(body.exprs[0], body.pathIfPipe),
    pathIfPipe: body.pathIfPipe,
  }
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
          tagCall = createCallExpressionStdLibKw('getOppositeEdge', tagCall, [])
        } else if (
          artifact.type === 'sweepEdge' &&
          artifact.subType === 'adjacent'
        ) {
          tagCall = createCallExpressionStdLibKw(
            'getNextAdjacentEdge',
            tagCall,
            []
          )
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

function getExprName(expr: Expr): string | null {
  if (expr.type === 'Name') {
    return expr.name.name
  }
  if (
    expr.type === 'MemberExpression' &&
    !expr.computed &&
    expr.property.type === 'Name'
  ) {
    return expr.property.name.name
  }
  return null
}

function getOriginalFaceForCopiedEdge(
  selectedFace: Extract<Artifact, { type: 'wall' | 'cap' }>,
  sourceFaces: Extract<Artifact, { type: 'wall' | 'cap' }>[],
  artifactGraph: ArtifactGraph
): Extract<Artifact, { type: 'wall' | 'cap' }> | Error {
  if (selectedFace.type === 'cap') {
    const sourceCap = sourceFaces.find(
      (face) => face.type === 'cap' && face.subType === selectedFace.subType
    )
    return sourceCap ?? new Error('Could not map copied cap to its source cap')
  }

  const originalSegment = getOriginalSegmentArtifact(
    selectedFace.segId,
    artifactGraph
  )
  if (!originalSegment) {
    return new Error('Could not resolve copied wall segment')
  }

  const sourceWall = sourceFaces.find((face) => {
    if (face.type !== 'wall') return false
    const sourceSegment = getOriginalSegmentArtifact(face.segId, artifactGraph)
    return sourceSegment?.id === originalSegment.id
  })
  return sourceWall ?? new Error('Could not map copied wall to its source wall')
}

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
  wasmInstance: ModuleType,
  options?: ModifyAstWithTagsOptions
): { modifiedAst: Node<Program>; exprs: Expr[] } | Error {
  if (
    !selection.artifact ||
    (selection.artifact.type !== 'sweepEdge' &&
      selection.artifact.type !== 'segment')
    //TODO: selection.artifact.type !== 'edgeCutEdge'
  ) {
    return new Error('Selection artifact is not a valid edge type')
  }

  let astClone = structuredClone(ast)
  const exprs: Expr[] = []
  const tagMethods = options?.tagMethods

  // Default: get common edge of 2 faces scenario
  if (!tagMethods || !tagMethods.includes('oppositeAndAdjacentEdges')) {
    const selectedFaces = getCommonFacesForEdge(
      selection.artifact,
      artifactGraph
    )
    if (err(selectedFaces)) return selectedFaces

    const edgeContext =
      options?.edgeContext ??
      resolveEdgeSelectionContext(
        astClone,
        selection,
        artifactGraph,
        wasmInstance,
        options?.nodeToEdit
      )
    if (err(edgeContext)) return edgeContext

    const sourceFaces = edgeContext.isClone
      ? [
          ...getArtifactsOfTypes(
            {
              keys: edgeContext.sourceSweep.surfaceIds,
              types: ['wall', 'cap'],
            },
            artifactGraph
          ).values(),
        ]
      : selectedFaces

    for (const selectedFace of selectedFaces) {
      const sourceFace = edgeContext.isClone
        ? getOriginalFaceForCopiedEdge(selectedFace, sourceFaces, artifactGraph)
        : selectedFace
      if (err(sourceFace)) return sourceFace

      const faceSelection: Selection = {
        ...selection,
        artifact: sourceFace,
      }

      const result = modifyAstWithTagForFaceSelection(
        astClone,
        faceSelection,
        artifactGraph,
        wasmInstance
      )
      if (err(result)) return result

      const { modifiedAst, expr } = result
      astClone = modifiedAst

      if (selectedFace.type === 'cap') {
        const tagName = getExprName(expr)
        if (!tagName) {
          return new Error(
            'Could not resolve the cap tag for the selected edge'
          )
        }
        exprs.push(
          createMemberExpression(
            createMemberExpression(
              structuredClone(edgeContext.selectedBodyExpr),
              'faces'
            ),
            tagName
          )
        )
      } else if (edgeContext.isClone) {
        const tagName = getExprName(expr)
        if (!tagName) {
          return new Error(
            'Could not resolve the source wall tag for the selected edge'
          )
        }
        exprs.push(
          createSketchTagMemberExpression(
            structuredClone(edgeContext.selectedBodyExpr),
            tagName
          )
        )
      } else {
        exprs.push(expr)
      }
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
    const pathToSegmentNode = selection.codeRef.pathToNode

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
    if (!(segmentNode.node.callee.name.name in sketchLineHelperMapKw)) {
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
  // CASE 2: Handle cap face - tag the extrusion/sweep
  else if (selection.artifact.type === 'cap') {
    // Each handler function creates its own clone and returns a new AST
    const result = modifyAstWithTagForCapFace(
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
  const regionTagExpr = getRegionTagExprFromSegmentId(
    astClone,
    segment.id,
    artifactGraph,
    wasmInstance
  )
  if (regionTagExpr) {
    return {
      modifiedAst: astClone,
      expr: regionTagExpr,
    }
  }

  // No tag path, no region (surface modeling): retrieve the segment through .sketch
  const sketchSolveSurfaceTagExpr = getSketchSolveSurfaceTagExprForWallFace(
    astClone,
    wallFace,
    artifactGraph,
    wasmInstance
  )
  if (sketchSolveSurfaceTagExpr) {
    return {
      modifiedAst: astClone,
      expr: sketchSolveSurfaceTagExpr,
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

function getSketchSolveSurfaceTagExprForWallFace(
  ast: Node<Program>,
  wallFace: Extract<Artifact, { type: 'wall' }>,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Expr | null {
  const sweepArtifact = getArtifactOfTypes(
    { key: wallFace.sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (err(sweepArtifact)) {
    return null
  }

  const sourceSurfaceVars = getVariableExprsFromSelection(
    {
      graphSelections: [
        {
          artifact: sweepArtifact,
          codeRef: sweepArtifact.codeRef,
        },
      ],
      otherSelections: [],
    },
    artifactGraph,
    ast,
    wasmInstance
  )
  if (err(sourceSurfaceVars) || sourceSurfaceVars.exprs.length !== 1) {
    return null
  }

  const sketchSegmentName = getSketchSegmentNameFromSourceSurface(
    sweepArtifact,
    wallFace,
    artifactGraph,
    ast,
    wasmInstance,
    { fallbackToFirstSegment: false }
  )
  if (!sketchSegmentName) {
    return null
  }

  return createSketchTagMemberExpression(
    sourceSurfaceVars.exprs[0],
    sketchSegmentName
  )
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
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
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

  const pathToSweepNode = sweepArtifact.codeRef.pathToNode

  const callExp = getNodeFromPath<CallExpressionKw>(
    astClone,
    pathToSweepNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (err(callExp)) return callExp

  // Get the cap type (Start or End)
  const capType = capitaliseFC(capFace.subType)

  // Use the appropriate tag parameter name (tagStart or tagEnd)
  const tagParamName = `tag${capType}`

  // Check for existing tag with this parameter name
  const existingTag = callExp.node.arguments.find(
    (arg) => arg.label?.name === tagParamName
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
      segmentNode.node.callee.name.name in sketchLineHelperMapKw ||
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
