import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createMemberExpression,
  createObjectExpression,
  createTagDeclarator,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  deleteTopLevelStatement,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import { deleteNodeInExtrudePipe } from '@src/lang/modifyAst/deleteNodeInExtrudePipe'
import {
  modifyAstWithTagsForSelection,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/tagManagement'
import {
  getNodeFromPath,
  getRegionSketchTagExprFromSourceSurface,
  getSketchSegmentNameFromSourceSurface,
  getVariableExprsFromSelection,
  locateVariableWithCallOrPipe,
  traverse,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import { findKwArg } from '@src/lang/util'
import type {
  Artifact,
  ArtifactGraph,
  CallExpressionKw,
  CodeRef,
  DirectTagFilletMeta,
  EdgeRefactorMeta,
  Expr,
  ExpressionStatement,
  MemberExpression,
  PathToNode,
  Program,
  VariableDeclarator,
} from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import {
  getBodySelectionFromPrimitiveParentEntityId,
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EnginePrimitiveSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'

function createMemberExpr(
  object: Expr,
  propertyName: string
): Node<MemberExpression> {
  return {
    type: 'MemberExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    object,
    property: createLocalName(propertyName),
    computed: false,
  }
}

export function addFillet({
  ast,
  artifactGraph,
  selection,
  radius,
  tag,
  version,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  selection: Selections
  radius: KclCommandValue
  tag?: string
  version?: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode[] // Array because multi-body selections create multiple fillet calls
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Group selections by body and add all tags first (before variable insertion)
  // This must happen before insertVariableAndOffsetPathToNode because that invalidates artifactGraph paths
  const bodyData = groupSelectionsByBodyAndAddTags(
    selection,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
  if (err(bodyData)) return bodyData
  let bodies = bodyData.bodies
  modifiedAst = bodyData.modifiedAst

  const primitiveEdgeSelections = getPrimitiveEdgeSelections(selection)
  if (primitiveEdgeSelections.length > 0) {
    const primitiveEdgeResult = insertPrimitiveEdgeVariablesAndOffsetPathToNode(
      {
        primitiveEdgeSelections,
        bodies,
        modifiedAst,
        artifactGraph,
        wasmInstance,
        nodeToEdit: mNodeToEdit,
      }
    )
    if (err(primitiveEdgeResult)) return primitiveEdgeResult
    bodies = primitiveEdgeResult.bodies
  }
  if (bodies.size === 0) {
    return new Error('No edges found in the selection')
  }

  // Insert variables for labeled arguments if provided
  if ('variableName' in radius && radius.variableName) {
    insertVariableAndOffsetPathToNode(radius, modifiedAst, mNodeToEdit)
  }
  if (version && 'variableName' in version && version.variableName) {
    insertVariableAndOffsetPathToNode(version, modifiedAst, mNodeToEdit)
  }

  // 3. Create fillet calls for each body
  const pathToNodes: PathToNode[] = []
  for (const data of bodies.values()) {
    const tagArgs = tag
      ? [createLabeledArg('tag', createTagDeclarator(tag))]
      : []
    const versionArgs = version
      ? [createLabeledArg('version', valueOrVariable(version))]
      : []
    const call = createCallExpressionStdLibKw('fillet', data.solidsExpr, [
      createLabeledArg('tags', data.tagsExpr),
      createLabeledArg('radius', valueOrVariable(radius)),
      ...tagArgs,
      ...versionArgs,
    ])

    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call,
      pathToEdit: mNodeToEdit,
      pathIfNewPipe: data.pathIfPipe,
      variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.FILLET,
      wasmInstance,
    })
    if (err(pathToNode)) return pathToNode
    pathToNodes.push(pathToNode)
  }

  return { modifiedAst, pathToNode: pathToNodes }
}

export function addChamfer({
  ast,
  artifactGraph,
  selection,
  length,
  secondLength,
  angle,
  tag,
  version,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  selection: Selections
  length: KclCommandValue
  secondLength?: KclCommandValue
  angle?: KclCommandValue
  tag?: string
  version?: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode[] // Array because multi-body selections create multiple chamfer calls
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Group selections by body and add all tags first (before variable insertion)
  // This must happen before insertVariableAndOffsetPathToNode because that invalidates artifactGraph paths
  const bodyData = groupSelectionsByBodyAndAddTags(
    selection,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
  if (err(bodyData)) return bodyData
  let bodies = bodyData.bodies
  modifiedAst = bodyData.modifiedAst

  const primitiveEdgeSelections = getPrimitiveEdgeSelections(selection)
  if (primitiveEdgeSelections.length > 0) {
    const primitiveEdgeResult = insertPrimitiveEdgeVariablesAndOffsetPathToNode(
      {
        primitiveEdgeSelections,
        bodies,
        modifiedAst,
        artifactGraph,
        wasmInstance,
        nodeToEdit: mNodeToEdit,
      }
    )
    if (err(primitiveEdgeResult)) return primitiveEdgeResult
    bodies = primitiveEdgeResult.bodies
  }
  if (bodies.size === 0) {
    return new Error('No edges found in the selection')
  }

  // Insert variables for labeled arguments if provided
  if ('variableName' in length && length.variableName) {
    insertVariableAndOffsetPathToNode(length, modifiedAst, mNodeToEdit)
  }
  if (
    secondLength &&
    'variableName' in secondLength &&
    secondLength.variableName
  ) {
    insertVariableAndOffsetPathToNode(secondLength, modifiedAst, mNodeToEdit)
  }
  if (angle && 'variableName' in angle && angle.variableName) {
    insertVariableAndOffsetPathToNode(angle, modifiedAst, mNodeToEdit)
  }
  if (version && 'variableName' in version && version.variableName) {
    insertVariableAndOffsetPathToNode(version, modifiedAst, mNodeToEdit)
  }

  // 3. Create chamfer calls for each body
  const pathToNodes: PathToNode[] = []
  for (const data of bodies.values()) {
    const secondLengthArgs = secondLength
      ? [createLabeledArg('secondLength', valueOrVariable(secondLength))]
      : []
    const angleArgs = angle
      ? [createLabeledArg('angle', valueOrVariable(angle))]
      : []
    const tagArgs = tag
      ? [createLabeledArg('tag', createTagDeclarator(tag))]
      : []
    const versionArgs = version
      ? [createLabeledArg('version', valueOrVariable(version))]
      : []

    const call = createCallExpressionStdLibKw('chamfer', data.solidsExpr, [
      createLabeledArg('tags', data.tagsExpr),
      createLabeledArg('length', valueOrVariable(length)),
      ...secondLengthArgs,
      ...angleArgs,
      ...tagArgs,
      ...versionArgs,
    ])

    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call,
      pathToEdit: mNodeToEdit,
      pathIfNewPipe: data.pathIfPipe,
      variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.CHAMFER,
      wasmInstance,
    })
    if (err(pathToNode)) return pathToNode
    pathToNodes.push(pathToNode)
  }

  return { modifiedAst, pathToNode: pathToNodes }
}

export function addBlend({
  ast,
  artifactGraph,
  edges,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  edges: Selections
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast so we can freely edit it
  let modifiedAst = structuredClone(ast)

  // 2. Validate the edge selection
  const selectedEdges = getEdgeSelections(edges)
  if (selectedEdges.length !== 2) {
    return new Error('Blend requires exactly two selected edges.')
  }

  // 3. Build two edges and use them in blend([edge1, edge2])
  const edgeExprs: Expr[] = []
  for (const edgeSelection of selectedEdges) {
    const edgeResult = buildEdgeExpr(
      edgeSelection,
      modifiedAst,
      artifactGraph,
      wasmInstance
    )
    if (err(edgeResult)) return edgeResult
    modifiedAst = edgeResult.modifiedAst
    edgeExprs.push(edgeResult.edgeExpr)
  }

  const call = createCallExpressionStdLibKw(
    'blend',
    createArrayExpression(edgeExprs),
    []
  )

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.BLEND,
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

type EdgeSelectionForExpr = Selection | EnginePrimitiveSelection
type BodySelectionData = {
  solidsExpr: Expr | null
  tagsExpr: Expr
  pathIfPipe?: PathToNode
}

function getEdgeSelections(edges: Selections): EdgeSelectionForExpr[] {
  return [...edges.graphSelections, ...getPrimitiveEdgeSelections(edges)]
}

function buildEdgeExpr(
  edgeSelection: EdgeSelectionForExpr,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Error | { modifiedAst: Node<Program>; edgeExpr: Expr } {
  if (
    typeof edgeSelection === 'object' &&
    'type' in edgeSelection &&
    edgeSelection.type === 'enginePrimitive'
  ) {
    if (!edgeSelection.parentEntityId) {
      return new Error(
        'Blend primitive edge selections must include a parent entity.'
      )
    }

    const primitiveEdgeResult = insertPrimitiveEdgeVariablesAndOffsetPathToNode(
      {
        primitiveEdgeSelections: [edgeSelection],
        bodies: new Map(),
        modifiedAst: ast,
        artifactGraph,
        wasmInstance,
      }
    )
    if (err(primitiveEdgeResult)) return primitiveEdgeResult

    const primitiveBody = [...primitiveEdgeResult.bodies.values()][0]
    if (!primitiveBody?.solidsExpr) {
      return new Error('Could not resolve the source surface for blend edge.')
    }

    const sourceSurfaceExpr = structuredClone(primitiveBody.solidsExpr)
    const primitiveEdgeIdExpr =
      primitiveBody.tagsExpr.type === 'ArrayExpression'
        ? primitiveBody.tagsExpr.elements[0]
        : primitiveBody.tagsExpr
    if (!primitiveEdgeIdExpr) {
      return new Error(
        'Blend primitive edge selections could not generate an edge identifier.'
      )
    }

    return {
      modifiedAst: ast,
      edgeExpr: createCallExpressionStdLibKw(
        'getBoundedEdge',
        sourceSurfaceExpr,
        [createLabeledArg('edge', primitiveEdgeIdExpr)]
      ),
    }
  }

  const graphEdgeSelection = edgeSelection as Selection
  const edgeArtifact = graphEdgeSelection.artifact
  if (
    !edgeArtifact ||
    (edgeArtifact.type !== 'sweepEdge' && edgeArtifact.type !== 'segment')
  ) {
    return new Error(
      'Blend only supports segment, sweepEdge, and enginePrimitiveEdge selections.'
    )
  }

  const sourceSurfaceArtifact = getSweepArtifactFromSelection(
    graphEdgeSelection,
    artifactGraph
  )
  if (err(sourceSurfaceArtifact)) {
    return sourceSurfaceArtifact
  }

  const sourceSurfaceVars = getVariableExprsFromSelection(
    {
      graphSelections: [
        {
          artifact: sourceSurfaceArtifact as Artifact,
          codeRef: sourceSurfaceArtifact.codeRef,
        },
      ],
      otherSelections: [],
    },
    artifactGraph,
    ast,
    wasmInstance
  )
  if (err(sourceSurfaceVars)) return sourceSurfaceVars
  if (sourceSurfaceVars.exprs.length !== 1) {
    return new Error('Expected exactly one source surface for each blend edge.')
  }
  const sourceSurfaceExpr = sourceSurfaceVars.exprs[0]

  // Region-based sketch-solve surface case: building region###.tags.line#.
  const regionSketchTagExpr = getRegionSketchTagExprFromSourceSurface(
    sourceSurfaceArtifact as Artifact,
    edgeArtifact,
    artifactGraph,
    ast,
    wasmInstance
  )
  if (regionSketchTagExpr) {
    const edgeExpr = getEdgeTagCall(regionSketchTagExpr, edgeArtifact)

    return {
      modifiedAst: ast,
      edgeExpr: createCallExpressionStdLibKw(
        'getBoundedEdge',
        structuredClone(sourceSurfaceExpr),
        [createLabeledArg('edge', edgeExpr)]
      ),
    }
  }

  // Sketch-solve surface case: building a sweep###.sketch.tags.line# expression.
  const sketchSegmentName = getSketchSegmentNameFromSourceSurface(
    sourceSurfaceArtifact as Artifact,
    edgeArtifact,
    artifactGraph,
    ast,
    wasmInstance
  )
  if (sketchSegmentName) {
    const sketchTagExpr = createMemberExpression(
      createMemberExpression(
        createMemberExpression(structuredClone(sourceSurfaceExpr), 'sketch'),
        'tags'
      ),
      sketchSegmentName
    )
    const edgeExpr = getEdgeTagCall(sketchTagExpr, edgeArtifact)

    return {
      modifiedAst: ast,
      edgeExpr: createCallExpressionStdLibKw(
        'getBoundedEdge',
        structuredClone(sourceSurfaceExpr),
        [createLabeledArg('edge', edgeExpr)]
      ),
    }
  }

  // Regular case
  const tagResult = modifyAstWithTagsForSelection(
    ast,
    graphEdgeSelection,
    artifactGraph,
    wasmInstance
  )
  if (err(tagResult)) return tagResult
  if (tagResult.exprs.length === 0) {
    return new Error('Expected at least one tag for each blend edge.')
  }

  const edgeExpr = getEdgeTagCall(tagResult.exprs[0], edgeArtifact)

  return {
    modifiedAst: tagResult.modifiedAst,
    edgeExpr: createCallExpressionStdLibKw(
      'getBoundedEdge',
      structuredClone(sourceSurfaceExpr),
      [createLabeledArg('edge', edgeExpr)]
    ),
  }
}

export function getPrimitiveEdgeSelections(
  edges: Selections
): EnginePrimitiveSelection[] {
  return edges.otherSelections.filter(
    (selection): selection is EnginePrimitiveSelection =>
      isEnginePrimitiveSelection(selection) &&
      selection.primitiveType === 'edge'
  )
}

// Utility functions

/**
 * Groups selections by body and adds tags to the AST.
 * Must be called BEFORE variable insertion to keep artifactGraph paths valid.
 *
 * @param selections - Edge selections to process
 * @param artifactGraph - Graph mapping artifacts to AST nodes
 * @param ast - The AST to modify
 * @param nodeToEdit - Optional path to the node being edited
 * @returns Object containing modified AST and Map of body data, or Error
 */
export function groupSelectionsByBodyAndAddTags(
  selections: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode
):
  | {
      modifiedAst: Node<Program>
      bodies: Map<string, BodySelectionData>
    }
  | Error {
  const selectionsByBody = groupSelectionsByBody(selections, artifactGraph)
  if (err(selectionsByBody)) return selectionsByBody

  let modifiedAst = ast
  const bodies = new Map<string, BodySelectionData>()

  for (const [bodyKey, bodySelections] of selectionsByBody.entries()) {
    // Add tags for graph selections in this body
    const { tagsExprs, modifiedAst: taggedAst } = getTagsExprsFromSelection(
      modifiedAst,
      bodySelections,
      artifactGraph,
      wasmInstance
    )
    modifiedAst = taggedAst

    let bodySelectionForSolids: Selection | undefined
    if (bodySelections.graphSelections.length > 0) {
      const sweep = getSweepArtifactFromSelection(
        bodySelections.graphSelections[0],
        artifactGraph
      )
      if (err(sweep)) return sweep
      bodySelectionForSolids = {
        artifact: sweep as Artifact,
        codeRef: sweep.codeRef,
      }
    }

    // Build solids expression
    const solids: Selections = {
      graphSelections: bodySelectionForSolids ? [bodySelectionForSolids] : [],
      otherSelections: [],
    }

    const vars = getVariableExprsFromSelection(
      solids,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      nodeToEdit,
      {
        lastChildLookup: true,
        artifactTypeFilter: ['compositeSolid', 'sweep'],
      }
    )
    if (err(vars)) return vars

    const solidsExpr = createVariableExpressionsArray(vars.exprs)

    if (tagsExprs.length === 0) {
      return new Error('No edges found in the selection')
    }

    const tagsExpr = createVariableExpressionsArray(tagsExprs)
    if (!tagsExpr) {
      return new Error('No edges found in the selection')
    }

    bodies.set(bodyKey, {
      solidsExpr,
      tagsExpr,
      pathIfPipe: vars.pathIfPipe,
    })
  }

  return { modifiedAst, bodies }
}

/**
 * Groups edge selections by their parent editable body.
 * Uses each body's pathToNode as a unique key.
 *
 * @param selections - Edge selections to group by body
 * @param artifactGraph - Graph mapping artifacts to AST nodes
 * @returns Map from body key to selections for that body, or Error
 */
function groupSelectionsByBody(
  selections: Selections,
  artifactGraph: ArtifactGraph
): Map<string, Selections> | Error {
  const bodyToSelections = new Map<string, Selection[]>()

  for (const selection of selections.graphSelections) {
    const sweepArtifact = getSweepArtifactFromSelection(
      selection,
      artifactGraph
    )
    if (err(sweepArtifact)) return sweepArtifact

    const bodyKey = JSON.stringify(sweepArtifact.codeRef.pathToNode)
    if (bodyToSelections.has(bodyKey)) {
      bodyToSelections.get(bodyKey)?.push(selection)
    } else {
      bodyToSelections.set(bodyKey, [selection])
    }
  }

  const result = new Map<string, Selections>()
  for (const [bodyKey, selections] of bodyToSelections.entries()) {
    result.set(bodyKey, {
      graphSelections: selections,
      otherSelections: [],
    })
  }

  return result
}

export function buildSolidsAndTagsExprs(
  faces: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode,
  solidsCount = 1
) {
  const solids: Selections = {
    graphSelections: faces.graphSelections.flatMap((f) => {
      if (!f.artifact) return []
      const sweep = getSweepArtifactFromSelection(f, artifactGraph)
      if (err(sweep) || !sweep) return []
      return {
        artifact: sweep as Artifact,
        codeRef: sweep.codeRef,
      }
    }),
    otherSelections: [],
  }
  // Map the sketches selection into a list of kcl expressions to be passed as unlabeled argument
  const vars = getVariableExprsFromSelection(
    solids,
    artifactGraph,
    ast,
    wasmInstance,
    nodeToEdit,
    {
      lastChildLookup: true,
    }
  )
  if (err(vars)) {
    return vars
  }

  if (vars.exprs.length > solidsCount) {
    return new Error(
      `Selection has more solids (${vars.exprs.length}) than expected (${solidsCount})`
    )
  }

  const pathIfPipe = vars.pathIfPipe
  const solidsExpr = createVariableExpressionsArray(vars.exprs)
  const { tagsExprs, modifiedAst } = getTagsExprsFromSelection(
    ast,
    faces,
    artifactGraph,
    wasmInstance
  )
  const tagsExpr = createVariableExpressionsArray(tagsExprs)
  if (!tagsExpr) {
    return new Error('No edges found in the selection')
  }

  return { solidsExpr, tagsExpr, pathIfPipe, modifiedAst }
}

function getTagsExprsFromSelection(
  ast: Node<Program>,
  edges: Selections,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
) {
  const tagsExprs: Expr[] = []
  let modifiedAst = ast
  for (const edge of edges.graphSelections) {
    if (edge.artifact?.type === 'primitiveEdge') {
      const variable = locateVariableWithCallOrPipe(
        ast,
        edge.codeRef.pathToNode,
        wasmInstance
      )
      if (err(variable)) continue
      tagsExprs.push(createLocalName(variable.variableDeclarator.id.name))
    }

    const result = modifyAstWithTagsForSelection(
      modifiedAst,
      edge,
      artifactGraph,
      wasmInstance
    )
    if (err(result)) {
      console.warn('Failed to add tag for edge selection', result)
      continue
    }

    tagsExprs.push(
      createCallExpressionStdLibKw('getCommonEdge', null, [
        createLabeledArg('faces', createArrayExpression(result.exprs)),
      ])
    )

    modifiedAst = result.modifiedAst
  }
  return { tagsExprs, modifiedAst }
}

// Sort of an opposite of getTagsExprsFromSelection above, used for edit flows
export function retrieveEdgeSelectionsFromOpArgs(
  tagsArg: OpArg,
  artifactGraph: ArtifactGraph
) {
  const tagValues: OpKclValue[] = []
  if (tagsArg.value.type === 'Array') {
    tagValues.push(...tagsArg.value.value)
  } else {
    tagValues.push(tagsArg.value)
  }

  const graphSelections: Selection[] = []
  const unmatchedEdgeEntityIds: string[] = []
  for (const v of tagValues) {
    if (!(v.type == 'Uuid' && v.value)) {
      console.warn('Face value is not a TagIdentifier', v)
      continue
    }

    const artifact = getArtifactOfTypes(
      { key: v.value, types: ['segment', 'sweepEdge', 'primitiveEdge'] },
      artifactGraph
    )
    if (err(artifact)) {
      console.warn(
        'No artifact found for face tag, will try primitive fallback',
        v.value
      )
      unmatchedEdgeEntityIds.push(v.value)
      continue
    }

    const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      console.warn('No codeRefs found for artifact', artifact)
      continue
    }

    graphSelections.push({
      artifact,
      codeRef: codeRefs[0],
    })
  }

  return { graphSelections, otherSelections: [] }
}

type FilletEdgeRefPayload = {
  side_faces: string[]
  end_faces?: string[]
  index?: number
}

export function createEdgeRefObjectExpression(
  payload: FilletEdgeRefPayload,
  wasmInstance: ModuleType,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  originalEdgeSelection?: Selection,
  fallbackCodeRef?: CodeRef,
  tagsBaseExpr?: Expr | null
): { expr: Expr; modifiedAst: Node<Program> } | Error {
  const sideFaceExprs: Expr[] = []
  let currentAst = ast

  const applyTagsBaseExprIfNeeded = (
    expr: Expr,
    faceArtifact: Artifact
  ): Expr => {
    if (
      tagsBaseExpr != null &&
      expr.type === 'Name' &&
      faceArtifact.type !== 'cap'
    ) {
      return createMemberExpr(
        createMemberExpr(structuredClone(tagsBaseExpr), 'tags'),
        expr.name?.name ?? ''
      )
    }
    return structuredClone(expr)
  }

  for (const faceId of payload.side_faces) {
    const faceArtifact = artifactGraph.get(faceId)
    if (!faceArtifact) {
      return new Error(
        `Could not find artifact for face ${faceId} in edge reference`
      )
    }

    const codeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
    if (!codeRefs?.length) {
      return new Error(
        `Could not find codeRefs for face ${faceId} in edge reference`
      )
    }

    if (faceArtifact.type === 'solid2d') {
      let segmentPathToNode: PathToNode | undefined

      if (
        originalEdgeSelection?.artifact &&
        originalEdgeSelection.artifact.type === 'segment'
      ) {
        segmentPathToNode = originalEdgeSelection.artifact.codeRef.pathToNode
      } else if (fallbackCodeRef?.pathToNode) {
        segmentPathToNode = fallbackCodeRef.pathToNode
      } else if (codeRefs[0]?.pathToNode) {
        segmentPathToNode = codeRefs[0].pathToNode
      }

      if (!segmentPathToNode?.length) {
        return new Error(
          `Cannot create tag for Solid2D edge ${faceId}: missing segment path`
        )
      }

      const tagResult = mutateAstWithTagForSketchSegment(
        currentAst,
        segmentPathToNode,
        wasmInstance
      )
      if (err(tagResult)) {
        return new Error(
          `Failed to create tag for Solid2D edge ${faceId}: ${tagResult.message}`
        )
      }

      sideFaceExprs.push(
        applyTagsBaseExprIfNeeded(createLocalName(tagResult.tag), faceArtifact)
      )
      currentAst = tagResult.modifiedAst
    } else {
      const tagResult = modifyAstWithTagsForSelection(
        currentAst,
        {
          artifact: faceArtifact,
          codeRef: codeRefs[0],
        },
        artifactGraph,
        wasmInstance
      )
      if (err(tagResult)) {
        return new Error(
          `Failed to create tag for face ${faceId}: ${tagResult.message}`
        )
      }

      const faceTagExpr = tagResult.exprs[0]
      if (!faceTagExpr) {
        return new Error(`Failed to extract tag name for face ${faceId}`)
      }

      sideFaceExprs.push(applyTagsBaseExprIfNeeded(faceTagExpr, faceArtifact))
      currentAst = tagResult.modifiedAst
    }
  }

  const endFaceExprs: Expr[] = []
  if (payload.end_faces?.length) {
    // `endFaces` narrows ambiguous side-face matches, but the refactor should
    // still be useful when we cannot tag them: `sideFaces` alone is valid KCL
    // and may intentionally select multiple adjacent edges for fillet/chamfer.
    for (const faceId of payload.end_faces) {
      const faceArtifact = artifactGraph.get(faceId)
      if (!faceArtifact) continue
      const codeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
      if (!codeRefs?.length) continue

      const tagResult = modifyAstWithTagsForSelection(
        currentAst,
        {
          artifact: faceArtifact,
          codeRef: codeRefs[0],
        },
        artifactGraph,
        wasmInstance
      )
      if (err(tagResult)) continue

      const endFaceTagExpr = tagResult.exprs[0]
      if (!endFaceTagExpr) continue

      endFaceExprs.push(structuredClone(endFaceTagExpr))
      currentAst = tagResult.modifiedAst
    }
  }

  const properties: Record<string, Expr> = {
    sideFaces: createArrayExpression(sideFaceExprs),
  }

  if (endFaceExprs.length > 0) {
    properties.endFaces = createArrayExpression(endFaceExprs)
  }

  if (payload.index !== undefined) {
    properties.index = createLiteral(payload.index, wasmInstance)
  }

  return {
    expr: createObjectExpression(properties),
    modifiedAst: currentAst,
  }
}

const DEPRECATED_EDGE_STDLIB: readonly string[] = [
  'getOppositeEdge',
  'getNextAdjacentEdge',
  'getPreviousAdjacentEdge',
  'getCommonEdge',
  'edgeId',
]

function isFilletOrChamfer(callee: string): boolean {
  return callee === 'fillet' || callee === 'chamfer'
}

function isRevolveOrHelix(callee: string): boolean {
  return callee === 'revolve' || callee === 'helix'
}

function isExtrude(callee: string): boolean {
  return callee === 'extrude'
}

function isGdtEdgeCommand(callee: string): boolean {
  return [
    'straightness',
    'circularity',
    'cylindricity',
    'profile',
    'profileLine',
    'position',
    'distance',
    'angularity',
    'concentricity',
    'symmetry',
    'runout',
    'perpendicularity',
    'parallelism',
    'annotation',
  ].includes(callee)
}

function isDeprecatedEdgeStdlib(calleeName: string | undefined): boolean {
  return Boolean(calleeName && DEPRECATED_EDGE_STDLIB.includes(calleeName))
}

function getLabelName(arg: Node<CallExpressionKw>['arguments'][number]) {
  return arg.label?.name
}

function getCalleeName(call: Node<CallExpressionKw>): string | undefined {
  return call.callee.name.name
}

function getTagsElementsFromCall(call: Node<CallExpressionKw>): Expr[] | null {
  const tagsArg = call.arguments?.find((a) => getLabelName(a) === 'tags')
  if (!tagsArg?.arg) return null
  if (tagsArg.arg.type === 'ArrayExpression') {
    return tagsArg.arg.elements ?? null
  }
  return [tagsArg.arg]
}

function getEdgesElementsFromCall(call: Node<CallExpressionKw>): Expr[] | null {
  const edgesArg = call.arguments?.find((a) => getLabelName(a) === 'edges')
  if (!edgesArg?.arg) return null
  if (edgesArg.arg.type === 'ArrayExpression') {
    return edgesArg.arg.elements ?? null
  }
  return [edgesArg.arg]
}

function getExistingEdgeRefsFromCall(call: Node<CallExpressionKw>): Expr[] {
  const edgeRefsArg = call.arguments?.find(
    (a) => getLabelName(a) === 'edges' || getLabelName(a) === 'edgeRefs'
  )
  if (!edgeRefsArg?.arg || edgeRefsArg.arg.type !== 'ArrayExpression') {
    return []
  }
  return edgeRefsArg.arg.elements ?? []
}

function getTagsBaseFromTagElement(el: Expr): Expr | null {
  const inner = getCallFromExpr(el)
  if (!inner) return null
  const calleeName = getCalleeName(inner)
  if (!isDeprecatedEdgeStdlib(calleeName)) {
    return null
  }

  const firstArg = inner.unlabeled ?? null
  if (!firstArg || firstArg.type !== 'MemberExpression') return null
  const outerMember = firstArg
  if (outerMember.object.type !== 'MemberExpression') return null
  const innerMember = outerMember.object
  const propName =
    innerMember.property.type === 'Name'
      ? innerMember.property.name.name
      : undefined
  if (propName !== 'tags') return null
  return innerMember.object
}

function isNestedScopePath(pathToNode: PathToNode): boolean {
  return pathToNode.some(
    ([, owner]) =>
      owner === 'FunctionExpression' ||
      owner === 'SketchBlock' ||
      owner === 'Block' ||
      owner === 'IfExpression'
  )
}

function findDeprecatedEdgeStdlibCallForVariable(
  program: Program,
  variableName: string,
  referencePath: PathToNode
): { call: Node<CallExpressionKw>; tagsBaseExpr: Expr | null } | null {
  // Variable lookup is currently top-level only. In nested scopes, a local
  // binding may shadow a top-level helper, so skip instead of risking an
  // incorrect migration.
  if (isNestedScopePath(referencePath)) {
    return null
  }

  for (const item of program.body ?? []) {
    if (item.type !== 'VariableDeclaration') continue
    if (item.declaration.id?.name !== variableName) continue

    const call = getCallFromExpr(item.declaration.init)
    if (!call) continue

    const calleeName = getCalleeName(call)
    if (!isDeprecatedEdgeStdlib(calleeName)) {
      continue
    }

    return {
      call,
      tagsBaseExpr: getTagsBaseFromTagElement(call),
    }
  }

  return null
}

function callSourceRangeMatches(
  meta: DirectTagFilletMeta,
  start: number,
  end: number,
  moduleId: number
): boolean {
  const sr = meta.callSourceRange
  return (
    Number(sr[0]) === start &&
    Number(sr[1]) === end &&
    Number(sr[2] ?? 0) === moduleId
  )
}

function sourceRangeMatch(
  meta: EdgeRefactorMeta,
  start: number,
  end: number,
  moduleId: number
): boolean {
  const [metaStart, metaEnd, metaModuleId = 0] = meta.sourceRange
  return metaModuleId === moduleId && metaStart === start && metaEnd === end
}

type Z0006SourceRange = [number, number, number]

function sourceRangesOverlap(
  a: Z0006SourceRange,
  b: Z0006SourceRange
): boolean {
  return a[2] === b[2] && a[0] < b[1] && b[0] < a[1]
}

function filterCallsBySourceRange<T extends { range: Z0006SourceRange }>(
  calls: T[],
  sourceRange?: Z0006SourceRange
): T[] {
  if (!sourceRange) return calls
  return calls.filter((call) => sourceRangesOverlap(call.range, sourceRange))
}

interface UnifiedCallToFix {
  range: Z0006SourceRange
  orderedPayloads: FilletEdgeRefPayload[]
  orderedEdgeRefExprs: Expr[]
  hasExistingEdgeRefs: boolean
  tagsBaseExpr?: Expr | null
}

function createEdgeRefFromGetCommonEdgeCall(
  call: Node<CallExpressionKw>
): Expr | null {
  if (getCalleeName(call) !== 'getCommonEdge') return null

  const facesArg = findKwArg('faces', call)
  if (!facesArg || facesArg.type !== 'ArrayExpression') return null

  const sideFaces = facesArg.elements ?? []
  if (sideFaces.length === 0) return null

  return createObjectExpression({
    sideFaces: createArrayExpression(structuredClone(sideFaces)),
  })
}

function findFilletChamferCallsToFixUnified(
  program: Node<Program>,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  directTagFilletMetadata: DirectTagFilletMeta[],
  artifactGraph: ArtifactGraph
): UnifiedCallToFix[] {
  const results: UnifiedCallToFix[] = []

  traverse(program, {
    enter(node, pathToNode) {
      if (node.type !== 'CallExpressionKw') return

      const call = node
      const calleeName = getCalleeName(call)
      if (!calleeName || !isFilletOrChamfer(calleeName)) return

      const elements = getTagsElementsFromCall(call)
      const existingEdgeRefExprs = getExistingEdgeRefsFromCall(call)
      const orderedPayloads: FilletEdgeRefPayload[] = []
      const orderedEdgeRefExprs: Expr[] = []
      let tagsBaseExpr: Expr | null = null
      let hasUnconvertedTagsElement = false

      if (elements?.length) {
        for (const el of elements) {
          if (tagsBaseExpr === null) {
            tagsBaseExpr = getTagsBaseFromTagElement(el)
          }

          const inner = getCallFromExpr(el)
          if (inner) {
            const innerCallee = getCalleeName(inner)
            if (isDeprecatedEdgeStdlib(innerCallee)) {
              const edgeRefExpr = createEdgeRefFromGetCommonEdgeCall(inner)
              if (edgeRefExpr) {
                orderedEdgeRefExprs.push(edgeRefExpr)
                continue
              }

              const meta = edgeRefactorMetadata.find((m) =>
                sourceRangeMatch(m, inner.start, inner.end, inner.moduleId)
              )
              if (meta) {
                orderedPayloads.push({
                  side_faces: meta.faceIds,
                })
              } else {
                hasUnconvertedTagsElement = true
              }
            } else {
              hasUnconvertedTagsElement = true
            }
          } else if (el.type === 'Name') {
            const tagName = el.name.name
            const moduleId = call.moduleId
            const directMeta = directTagFilletMetadata.find((m) =>
              callSourceRangeMatches(m, call.start, call.end, moduleId)
            )
            const tagEntry = directMeta?.tags?.find(
              (t: { tagIdentifier: string }) => t.tagIdentifier === tagName
            )
            if (tagEntry) {
              orderedPayloads.push({ side_faces: tagEntry.faceIds })
              continue
            }

            const deprecatedCall = findDeprecatedEdgeStdlibCallForVariable(
              program,
              tagName,
              pathToNode
            )
            if (deprecatedCall) {
              if (tagsBaseExpr === null && deprecatedCall.tagsBaseExpr) {
                tagsBaseExpr = deprecatedCall.tagsBaseExpr
              }

              const meta = edgeRefactorMetadata.find((m) =>
                sourceRangeMatch(
                  m,
                  deprecatedCall.call.start,
                  deprecatedCall.call.end,
                  deprecatedCall.call.moduleId
                )
              )
              if (meta) {
                orderedPayloads.push({
                  side_faces: meta.faceIds,
                })
              } else {
                hasUnconvertedTagsElement = true
              }
            } else {
              hasUnconvertedTagsElement = true
            }
          } else {
            hasUnconvertedTagsElement = true
          }
        }
      }

      if (
        elements?.length &&
        !hasUnconvertedTagsElement &&
        (orderedPayloads.length > 0 ||
          orderedEdgeRefExprs.length > 0 ||
          existingEdgeRefExprs.length > 0)
      ) {
        const moduleId = call.moduleId
        results.push({
          range: [call.start, call.end, moduleId],
          orderedPayloads,
          orderedEdgeRefExprs,
          hasExistingEdgeRefs: existingEdgeRefExprs.length > 0,
          tagsBaseExpr: tagsBaseExpr ?? undefined,
        })
      }
    },
  })

  return results
}

interface RevolveHelixCallToFix {
  range: Z0006SourceRange
  faceIds: [string, string]
  pathToCall?: PathToNode
}

interface ExtrudeToCallToFix {
  range: Z0006SourceRange
  faceIds: [string, string]
  pathToCall?: PathToNode
}

interface GdtEdgesCallToFix {
  range: Z0006SourceRange
  orderedPayloads: FilletEdgeRefPayload[]
  pathToCall?: PathToNode
}

interface GdtDistanceEndpointCallToFix {
  range: Z0006SourceRange
  endpoints: Array<{
    label: 'from' | 'to'
    payload: FilletEdgeRefPayload
  }>
  pathToCall?: PathToNode
}

function getCallFromExpr(expr: Expr): Node<CallExpressionKw> | null {
  if (!expr || typeof expr !== 'object') return null
  if (expr.type === 'CallExpressionKw') return expr
  return null
}

export function findRevolveHelixCallsToFix(
  program: Node<Program>,
  edgeRefactorMetadata: EdgeRefactorMeta[]
): RevolveHelixCallToFix[] {
  const results: RevolveHelixCallToFix[] = []

  traverse(program, {
    enter(node, pathToNode) {
      if (node.type !== 'CallExpressionKw') return

      const call = node
      const calleeName = getCalleeName(call)
      if (!calleeName || !isRevolveOrHelix(calleeName)) return

      const axisArg = findKwArg('axis', call)
      const inner = axisArg ? getCallFromExpr(axisArg) : null
      if (!inner) return

      const innerCallee = getCalleeName(inner)
      if (!isDeprecatedEdgeStdlib(innerCallee)) return

      const innerStart = inner.start
      const innerEnd = inner.end
      const innerModuleId = inner.moduleId
      const meta = edgeRefactorMetadata.find((m) =>
        sourceRangeMatch(m, innerStart, innerEnd, innerModuleId)
      )
      const moduleId = call.moduleId
      const callStart = call.start
      const callEnd = call.end
      if (meta) {
        results.push({
          range: [callStart, callEnd, moduleId],
          faceIds: [meta.faceIds[0], meta.faceIds[1]],
          pathToCall: pathToNode,
        })
      }
    },
  })

  return results
}

function findToArg(call: Node<CallExpressionKw>): Expr | null {
  const arg = call.arguments?.find((a) => getLabelName(a) === 'to')
  return arg?.arg ?? null
}

export function findExtrudeToCallsToFix(
  program: Node<Program>,
  edgeRefactorMetadata: EdgeRefactorMeta[]
): ExtrudeToCallToFix[] {
  const results: ExtrudeToCallToFix[] = []

  traverse(program, {
    enter(node, pathToNode) {
      if (node.type !== 'CallExpressionKw') return

      const call = node
      const calleeName = getCalleeName(call)
      if (!calleeName || !isExtrude(calleeName)) return

      const toArg = findToArg(call)
      const inner = toArg ? getCallFromExpr(toArg) : null
      if (!inner) return

      const innerCallee = getCalleeName(inner)
      if (!isDeprecatedEdgeStdlib(innerCallee)) return

      const innerStart = inner.start
      const innerEnd = inner.end
      const innerModuleId = inner.moduleId
      const meta = edgeRefactorMetadata.find((m) =>
        sourceRangeMatch(m, innerStart, innerEnd, innerModuleId)
      )
      const moduleId = call.moduleId
      const callStart = call.start
      const callEnd = call.end
      if (meta) {
        results.push({
          range: [callStart, callEnd, moduleId],
          faceIds: [meta.faceIds[0], meta.faceIds[1]],
          pathToCall: pathToNode,
        })
      }
    },
  })

  return results
}

export function findGdtEdgesCallsToFix(
  program: Node<Program>,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  artifactGraph: ArtifactGraph
): GdtEdgesCallToFix[] {
  const results: GdtEdgesCallToFix[] = []

  traverse(program, {
    enter(node, pathToNode) {
      if (node.type !== 'CallExpressionKw') return

      const call = node
      const calleeName = getCalleeName(call)
      if (!calleeName || !isGdtEdgeCommand(calleeName)) return

      const elements = getEdgesElementsFromCall(call)
      if (!elements?.length) return

      const orderedPayloads: FilletEdgeRefPayload[] = []
      let hasUnconvertedEdgesElement = false

      for (const el of elements) {
        if (el.type === 'ObjectExpression') continue

        const inner = getCallFromExpr(el)
        if (!inner) {
          hasUnconvertedEdgesElement = true
          continue
        }

        const innerCallee = getCalleeName(inner)
        if (!isDeprecatedEdgeStdlib(innerCallee)) {
          hasUnconvertedEdgesElement = true
          continue
        }

        const meta = edgeRefactorMetadata.find((m) =>
          sourceRangeMatch(m, inner.start, inner.end, inner.moduleId)
        )
        if (!meta) {
          hasUnconvertedEdgesElement = true
          continue
        }

        orderedPayloads.push({
          side_faces: meta.faceIds,
        })
      }

      if (hasUnconvertedEdgesElement || orderedPayloads.length === 0) return

      results.push({
        range: [call.start, call.end, call.moduleId],
        orderedPayloads,
        pathToCall: pathToNode,
      })
    },
  })

  return results
}

export function findGdtDistanceEndpointCallsToFix(
  program: Node<Program>,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  artifactGraph: ArtifactGraph
): GdtDistanceEndpointCallToFix[] {
  const results: GdtDistanceEndpointCallToFix[] = []

  traverse(program, {
    enter(node, pathToNode) {
      if (node.type !== 'CallExpressionKw') return

      const call = node
      const calleeName = getCalleeName(call)
      if (calleeName !== 'distance') return

      const endpoints: GdtDistanceEndpointCallToFix['endpoints'] = []

      for (const label of ['from', 'to'] as const) {
        const endpointArg = call.arguments?.find(
          (a) => getLabelName(a) === label
        )
        if (!endpointArg?.arg) continue

        const inner = getCallFromExpr(endpointArg.arg)
        if (!inner) continue

        const innerCallee = getCalleeName(inner)
        if (!isDeprecatedEdgeStdlib(innerCallee)) continue

        const meta = edgeRefactorMetadata.find((m) =>
          sourceRangeMatch(m, inner.start, inner.end, inner.moduleId)
        )
        if (!meta) continue

        endpoints.push({
          label,
          payload: {
            side_faces: meta.faceIds,
          },
        })
      }

      if (endpoints.length === 0) return

      results.push({
        range: [call.start, call.end, call.moduleId],
        endpoints,
        pathToCall: pathToNode,
      })
    },
  })

  return results
}

function refactorRevolveHelixAxisToEdgeRefInPlace(
  modifiedAst: Node<Program>,
  toFix: RevolveHelixCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  if (toFix.length === 0) return modifiedAst
  for (let index = 0; index < toFix.length; index++) {
    const { faceIds, pathToCall } = toFix[index]
    const path = pathToCall?.length ? pathToCall : pathList[index]
    const result = createEdgeRefObjectExpression(
      { side_faces: faceIds },
      wasmInstance,
      modifiedAst,
      artifactGraph
    )
    if (err(result)) continue
    modifiedAst = result.modifiedAst
    const nodeResult = getNodeFromPath<Node<CallExpressionKw>>(
      modifiedAst,
      path,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(nodeResult)) continue
    const callNode = nodeResult.node
    const newArgs = (callNode.arguments ?? []).filter(
      (a) => getLabelName(a) !== 'axis'
    )
    newArgs.push(createLabeledArg('axis', result.expr))
    callNode.arguments = newArgs
  }
  return modifiedAst
}

function refactorExtrudeToToEdgeSpecifierInPlace(
  modifiedAst: Node<Program>,
  toFix: ExtrudeToCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  if (toFix.length === 0) return modifiedAst
  for (let index = 0; index < toFix.length; index++) {
    const { faceIds, pathToCall } = toFix[index]
    const path = pathToCall?.length ? pathToCall : pathList[index]
    const result = createEdgeRefObjectExpression(
      { side_faces: faceIds },
      wasmInstance,
      modifiedAst,
      artifactGraph
    )
    if (err(result)) continue
    modifiedAst = result.modifiedAst
    const nodeResult = getNodeFromPath<Node<CallExpressionKw>>(
      modifiedAst,
      path,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(nodeResult)) continue
    const callNode = nodeResult.node
    const newArgs = (callNode.arguments ?? []).filter(
      (a) => getLabelName(a) !== 'to'
    )
    newArgs.push(createLabeledArg('to', result.expr))
    callNode.arguments = newArgs
  }
  return modifiedAst
}

function refactorGdtEdgesToEdgeSpecifiersInPlace(
  modifiedAst: Node<Program>,
  toFix: GdtEdgesCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  if (toFix.length === 0) return modifiedAst

  for (let index = 0; index < toFix.length; index++) {
    const { orderedPayloads, pathToCall } = toFix[index]
    const path = pathToCall?.length ? pathToCall : pathList[index]
    let nextAst = structuredClone(modifiedAst)
    const edgeRefExprs: Expr[] = []
    let failedToCreateEdgeRef = false

    for (const payload of orderedPayloads) {
      const result = createEdgeRefObjectExpression(
        payload,
        wasmInstance,
        nextAst,
        artifactGraph
      )
      if (err(result)) {
        failedToCreateEdgeRef = true
        break
      }
      edgeRefExprs.push(result.expr)
      nextAst = result.modifiedAst
    }

    if (failedToCreateEdgeRef || edgeRefExprs.length === 0) continue

    const nodeResult = getNodeFromPath<Node<CallExpressionKw>>(
      nextAst,
      path,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(nodeResult)) continue

    const callNode = nodeResult.node
    const existingEdgeRefs = getExistingEdgeRefsFromCall(callNode).filter(
      (expr) => expr.type === 'ObjectExpression'
    )
    const newArgs = (callNode.arguments ?? []).filter(
      (a) => getLabelName(a) !== 'edges'
    )
    newArgs.push(
      createLabeledArg(
        'edges',
        createArrayExpression([...edgeRefExprs, ...existingEdgeRefs])
      )
    )
    callNode.arguments = newArgs
    modifiedAst = nextAst
  }

  return modifiedAst
}

function refactorGdtDistanceEndpointsToEdgeSpecifiersInPlace(
  modifiedAst: Node<Program>,
  toFix: GdtDistanceEndpointCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  if (toFix.length === 0) return modifiedAst

  for (let index = 0; index < toFix.length; index++) {
    const { endpoints, pathToCall } = toFix[index]
    const path = pathToCall?.length ? pathToCall : pathList[index]
    let nextAst = structuredClone(modifiedAst)
    const endpointExprs: Array<{ label: 'from' | 'to'; expr: Expr }> = []
    let failedToCreateEndpointRef = false

    for (const endpoint of endpoints) {
      const result = createEdgeRefObjectExpression(
        endpoint.payload,
        wasmInstance,
        nextAst,
        artifactGraph
      )
      if (err(result)) {
        failedToCreateEndpointRef = true
        break
      }
      endpointExprs.push({ label: endpoint.label, expr: result.expr })
      nextAst = result.modifiedAst
    }

    if (failedToCreateEndpointRef || endpointExprs.length === 0) continue

    const nodeResult = getNodeFromPath<Node<CallExpressionKw>>(
      nextAst,
      path,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(nodeResult)) continue

    const callNode = nodeResult.node
    const replacedLabels = new Set(endpointExprs.map(({ label }) => label))
    const newArgs = (callNode.arguments ?? []).filter(
      (a) => !replacedLabels.has(getLabelName(a) as 'from' | 'to')
    )
    for (const endpointExpr of endpointExprs) {
      newArgs.push(createLabeledArg(endpointExpr.label, endpointExpr.expr))
    }
    callNode.arguments = newArgs
    modifiedAst = nextAst
  }

  return modifiedAst
}

export function refactorZ0006Unified(
  ast: Node<Program>,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  directTagFilletMetadata: DirectTagFilletMeta[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType,
  sourceRange?: Z0006SourceRange
): string | Error {
  const toFixFilletChamfer = filterCallsBySourceRange(
    findFilletChamferCallsToFixUnified(
      ast,
      edgeRefactorMetadata,
      directTagFilletMetadata,
      artifactGraph
    ),
    sourceRange
  )
  const toFixRevolveHelix = filterCallsBySourceRange(
    findRevolveHelixCallsToFix(ast, edgeRefactorMetadata),
    sourceRange
  )
  const toFixExtrudeTo = filterCallsBySourceRange(
    findExtrudeToCallsToFix(ast, edgeRefactorMetadata),
    sourceRange
  )
  const toFixGdtEdges = filterCallsBySourceRange(
    findGdtEdgesCallsToFix(ast, edgeRefactorMetadata, artifactGraph),
    sourceRange
  )
  const toFixGdtDistanceEndpoints = filterCallsBySourceRange(
    findGdtDistanceEndpointCallsToFix(ast, edgeRefactorMetadata, artifactGraph),
    sourceRange
  )
  if (
    toFixFilletChamfer.length === 0 &&
    toFixRevolveHelix.length === 0 &&
    toFixExtrudeTo.length === 0 &&
    toFixGdtEdges.length === 0 &&
    toFixGdtDistanceEndpoints.length === 0
  ) {
    return new Error('No Z0006 fixes to apply')
  }

  let modifiedAst = structuredClone(ast)

  for (const {
    range,
    orderedPayloads,
    orderedEdgeRefExprs,
    hasExistingEdgeRefs,
    tagsBaseExpr,
  } of toFixFilletChamfer) {
    let nextAst = structuredClone(modifiedAst)
    const path = getNodePathFromSourceRange(nextAst, range)
    const edgeRefExprs: Expr[] = structuredClone(orderedEdgeRefExprs)
    let failedToCreateEdgeRef = false
    for (const payload of orderedPayloads) {
      const result = createEdgeRefObjectExpression(
        payload,
        wasmInstance,
        nextAst,
        artifactGraph,
        undefined,
        undefined,
        tagsBaseExpr
      )
      if (err(result)) {
        failedToCreateEdgeRef = true
        break
      }
      edgeRefExprs.push(result.expr)
      nextAst = result.modifiedAst
    }
    if (failedToCreateEdgeRef) continue
    const nodeResult = getNodeFromPath<Node<CallExpressionKw>>(
      nextAst,
      path,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(nodeResult)) continue
    const callNode = nodeResult.node
    if (hasExistingEdgeRefs) {
      edgeRefExprs.push(...getExistingEdgeRefsFromCall(callNode))
    }
    if (edgeRefExprs.length === 0) continue
    const newArgs = (callNode.arguments ?? []).filter(
      (a) =>
        getLabelName(a) !== 'tags' &&
        getLabelName(a) !== 'edges' &&
        getLabelName(a) !== 'edgeRefs'
    )
    newArgs.push(createLabeledArg('edges', createArrayExpression(edgeRefExprs)))
    callNode.arguments = newArgs
    modifiedAst = nextAst
  }

  modifiedAst = refactorRevolveHelixAxisToEdgeRefInPlace(
    modifiedAst,
    toFixRevolveHelix,
    toFixRevolveHelix.map((item) =>
      item.pathToCall?.length
        ? item.pathToCall
        : getNodePathFromSourceRange(ast, item.range)
    ),
    artifactGraph,
    wasmInstance
  )

  modifiedAst = refactorExtrudeToToEdgeSpecifierInPlace(
    modifiedAst,
    toFixExtrudeTo,
    toFixExtrudeTo.map((item) =>
      item.pathToCall?.length
        ? item.pathToCall
        : getNodePathFromSourceRange(ast, item.range)
    ),
    artifactGraph,
    wasmInstance
  )

  modifiedAst = refactorGdtEdgesToEdgeSpecifiersInPlace(
    modifiedAst,
    toFixGdtEdges,
    toFixGdtEdges.map((item) =>
      item.pathToCall?.length
        ? item.pathToCall
        : getNodePathFromSourceRange(ast, item.range)
    ),
    artifactGraph,
    wasmInstance
  )

  modifiedAst = refactorGdtDistanceEndpointsToEdgeSpecifiersInPlace(
    modifiedAst,
    toFixGdtDistanceEndpoints,
    toFixGdtDistanceEndpoints.map((item) =>
      item.pathToCall?.length
        ? item.pathToCall
        : getNodePathFromSourceRange(ast, item.range)
    ),
    artifactGraph,
    wasmInstance
  )

  const out = recast(modifiedAst, wasmInstance)
  return err(out) ? out : out
}

function faceRefToArtifactId(v: OpKclValue): string | null {
  if (v.type === 'Uuid' && v.value) return v.value
  if (v.type === 'TagIdentifier' && v.artifact_id) {
    return v.artifact_id
  }
  return null
}

function findEdgeArtifactFromFaceIds(
  faceIds: string[],
  artifactGraph: ArtifactGraph
): Artifact | null {
  if (faceIds.length === 0) return null
  const faceArtifacts: Artifact[] = []
  for (const id of faceIds) {
    const artifact = artifactGraph.get(id)
    if (artifact) faceArtifacts.push(artifact)
  }
  if (faceArtifacts.length === 0) return null

  const edgeType = (
    artifact: Artifact
  ): artifact is Artifact & { type: 'segment' | 'edgeCut' } =>
    artifact.type === 'segment' || artifact.type === 'edgeCut'
  const directEdge = faceArtifacts.find(edgeType)
  if (directEdge) return directEdge

  const faceIdSet = new Set(faceIds)
  for (const [, artifact] of artifactGraph) {
    if (artifact.type !== 'segment') continue
    const commonIds = artifact.commonSurfaceIds
    if (!commonIds?.length) continue
    const commonIdSet = new Set(commonIds)
    if (
      faceIdSet.size === commonIdSet.size &&
      [...faceIdSet].every((id) => commonIdSet.has(id))
    ) {
      return artifact
    }
  }

  return null
}

export function retrieveEdgeSelectionsFromEdgeRefs(
  edgeRefsArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (edgeRefsArg.value.type !== 'Array') {
    return new Error('edges argument is not an array')
  }

  const graphSelections: Selection[] = []
  for (const item of edgeRefsArg.value.value) {
    if (item.type !== 'Object' || !item.value) continue
    // Selection recovery only needs the primary graph edge so edit/delete flows
    // can reselect an operation in the scene. `endFaces` and `index` refine how
    // the engine resolves ambiguous edge specifiers, but they are not needed to
    // recover the editable artifact from the current artifact graph.
    const facesProp = item.value.sideFaces
    if (facesProp?.type !== 'Array') continue
    const faceIds = facesProp.value
      .map(faceRefToArtifactId)
      .filter((id): id is string => Boolean(id))
    if (faceIds.length < 2) continue

    const edgeArtifact = findEdgeArtifactFromFaceIds(faceIds, artifactGraph)
    if (!edgeArtifact) continue
    const codeRefs = getCodeRefsByArtifactId(edgeArtifact.id, artifactGraph)
    if (!codeRefs?.length) continue
    graphSelections.push({
      artifact: edgeArtifact,
      codeRef: codeRefs[0],
    })
  }

  return { graphSelections, otherSelections: [] }
}

export function retrieveEdgeSelectionsFromSingleEdgeRef(
  edgeRefArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (edgeRefArg.value.type !== 'Object' || !edgeRefArg.value.value) {
    return new Error('edgeRef argument is not an object')
  }

  // Selection recovery intentionally uses only side faces. `endFaces` and
  // `index` are engine disambiguators for executing the edge specifier, while
  // this path only needs to map the stdlib argument back to a selectable graph
  // artifact for editing.
  const facesProp = edgeRefArg.value.value.sideFaces
  if (facesProp?.type !== 'Array') {
    return new Error('edgeRef has no sideFaces array')
  }

  const faceIds = facesProp.value
    .map(faceRefToArtifactId)
    .filter((id): id is string => Boolean(id))
  if (faceIds.length < 2) {
    return new Error('edgeRef sideFaces array needs at least 2 faces')
  }

  const edgeArtifact = findEdgeArtifactFromFaceIds(faceIds, artifactGraph)
  if (!edgeArtifact) {
    return new Error('Could not find edge from faces in artifact graph')
  }
  const codeRefs = getCodeRefsByArtifactId(edgeArtifact.id, artifactGraph)
  if (!codeRefs?.length) {
    return new Error('Edge artifact has no codeRef')
  }

  return {
    graphSelections: [
      {
        artifact: edgeArtifact,
        codeRef: codeRefs[0],
      },
    ],
    otherSelections: [],
  }
}

// Delete Edge Treatment
// Type Guards
// Edge Treatment Types
export enum EdgeTreatmentType {
  Chamfer = 'chamfer',
  Fillet = 'fillet',
}
// Type Guards
function isEdgeTreatmentType(name: string): name is EdgeTreatmentType {
  return name === EdgeTreatmentType.Chamfer || name === EdgeTreatmentType.Fillet
}
export async function deleteEdgeTreatment(
  ast: Node<Program>,
  selection: Selection,
  wasmInstance: ModuleType
): Promise<Node<Program> | Error> {
  /**
   * Deletes an edge treatment (fillet or chamfer) from the AST
   *
   * Supported cases:
   * [+] fillet and chamfer
   * [+] piped, standalone (assigned and unassigned) edge treatments
   * [-] delete single tag from array of tags (currently whole expression is deleted)
   * [-] multiple selections with different edge treatments (currently single selection is supported)
   */

  // 1. Validate Selection Type
  const { artifact } = selection
  if (!artifact || artifact.type !== 'edgeCut') {
    return new Error('Selection is not an edge cut')
  }

  const { subType } = artifact
  if (!isEdgeTreatmentType(subType)) {
    return new Error('Unsupported or missing edge treatment type')
  }

  // 2. Clone ast and retrieve the edge treatment node
  const astClone = structuredClone(ast)
  const edgeTreatmentNode = getNodeFromPath<
    VariableDeclarator | ExpressionStatement
  >(astClone, selection?.codeRef?.pathToNode, wasmInstance, [
    'VariableDeclarator',
    'ExpressionStatement',
  ])
  if (err(edgeTreatmentNode)) return edgeTreatmentNode

  // 3: Delete edge treatments
  // There 3 possible cases:
  // - piped: const body = extrude(...) |> fillet(...)
  // - assigned to variables: fillet0001 = fillet(...)
  // - unassigned standalone statements: fillet(...)
  // piped and assigned nodes are in the variable declarator
  // unassigned nodes are in the expression statement

  if (
    edgeTreatmentNode.node.type === 'ExpressionStatement' || // unassigned
    (edgeTreatmentNode.node.type === 'VariableDeclarator' && // assigned
      edgeTreatmentNode.node.init?.type !== 'PipeExpression')
  ) {
    // Handle both standalone cases (assigned and unassigned)
    const deleteResult = deleteTopLevelStatement(
      astClone,
      selection.codeRef.pathToNode
    )
    if (err(deleteResult)) return deleteResult
    return astClone
  } else {
    const deleteResult = deleteNodeInExtrudePipe(
      astClone,
      selection.codeRef.pathToNode,
      wasmInstance
    )
    if (err(deleteResult)) return deleteResult
    return astClone
  }
}

export function getEdgeTagCall(
  tag: string | Expr,
  artifact: Artifact
): Node<Expr | CallExpressionKw> {
  let tagCall: Expr = typeof tag === 'string' ? createLocalName(tag) : tag

  // Modify the tag based on selectionType
  if (artifact.type === 'sweepEdge' && artifact.subType === 'opposite') {
    tagCall = createCallExpressionStdLibKw('getOppositeEdge', tagCall, [])
  } else if (artifact.type === 'sweepEdge' && artifact.subType === 'adjacent') {
    tagCall = createCallExpressionStdLibKw('getNextAdjacentEdge', tagCall, [])
  }
  return tagCall
}

// Adds all the edgeId calls needed in the AST so we can refer to them,
// keeps track of their names as "tags",
// and gathers the corresponding solid expressions.
export function insertPrimitiveEdgeVariablesAndOffsetPathToNode({
  primitiveEdgeSelections,
  bodies,
  modifiedAst,
  artifactGraph,
  wasmInstance,
  nodeToEdit,
}: {
  primitiveEdgeSelections: EnginePrimitiveSelection[]
  bodies: Map<string, BodySelectionData>
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
}): Error | { bodies: Map<string, BodySelectionData> } {
  if (primitiveEdgeSelections.length === 0) {
    return { bodies }
  }

  const primitiveSelectionsByBody = new Map<
    string,
    {
      bodySelection: Selection
      primitiveIndices: number[]
    }
  >()

  // Step 1. Gather all the indices by body
  for (const selection of primitiveEdgeSelections) {
    if (!selection.parentEntityId) {
      continue
    }

    const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
      selection.parentEntityId,
      artifactGraph
    )
    if (!bodySelection?.artifact) {
      continue
    }

    const bodyKey = JSON.stringify(bodySelection.codeRef.pathToNode)
    const byBody = primitiveSelectionsByBody.get(bodyKey)
    if (byBody) {
      if (!byBody.primitiveIndices.includes(selection.primitiveIndex)) {
        byBody.primitiveIndices.push(selection.primitiveIndex)
      }
    } else {
      primitiveSelectionsByBody.set(bodyKey, {
        bodySelection,
        primitiveIndices: [selection.primitiveIndex],
      })
    }
  }

  if (primitiveSelectionsByBody.size === 0) {
    return { bodies }
  }

  // Step 2. Create an array of variable references to bodies
  const updatedBodies = new Map(bodies)
  let insertIndex = modifiedAst.body.length
  for (const [bodyKey, primitiveData] of primitiveSelectionsByBody.entries()) {
    let bodyData = updatedBodies.get(bodyKey)
    let tagsExprs: Expr[] = []
    let solidsExpr: Expr | null = null
    let pathIfPipe: PathToNode | undefined

    if (bodyData) {
      tagsExprs =
        bodyData.tagsExpr.type === 'ArrayExpression'
          ? [...bodyData.tagsExpr.elements]
          : [bodyData.tagsExpr]
      solidsExpr = bodyData.solidsExpr
      pathIfPipe = bodyData.pathIfPipe
    } else {
      const vars = getVariableExprsFromSelection(
        {
          graphSelections: [primitiveData.bodySelection],
          otherSelections: [],
        },
        artifactGraph,
        modifiedAst,
        wasmInstance,
        nodeToEdit,
        {
          lastChildLookup: true,
          artifactTypeFilter: ['compositeSolid', 'sweep'],
        }
      )
      if (err(vars)) return vars
      solidsExpr = createVariableExpressionsArray(vars.exprs)
      pathIfPipe = vars.pathIfPipe
    }

    if (!solidsExpr) {
      return new Error(
        'Could not resolve selected primitive edge bodies in code.'
      )
    }

    // Step 3. Insert variable declarations for edgeId calls
    for (const primitiveIndex of primitiveData.primitiveIndices) {
      const edgeIdExpr = createCallExpressionStdLibKw(
        'edgeId',
        structuredClone(solidsExpr),
        [createLabeledArg('index', createLiteral(primitiveIndex, wasmInstance))]
      )
      const edgeVariableName = findUniqueName(
        modifiedAst,
        KCL_DEFAULT_CONSTANT_PREFIXES.EDGE
      )
      const variableIdentifierAst = createLocalName(edgeVariableName)
      insertVariableAndOffsetPathToNode(
        {
          valueAst: edgeIdExpr,
          valueText: '',
          valueCalculated: '',
          variableName: edgeVariableName,
          variableDeclarationAst: createVariableDeclaration(
            edgeVariableName,
            edgeIdExpr
          ),
          variableIdentifierAst,
          insertIndex,
        },
        modifiedAst
      )
      insertIndex++
      tagsExprs.push(variableIdentifierAst)
    }

    const tagsExpr = createVariableExpressionsArray(tagsExprs)
    if (!tagsExpr) {
      return new Error('No edges found in the selection')
    }

    bodyData = {
      solidsExpr,
      tagsExpr,
      pathIfPipe,
    }
    updatedBodies.set(bodyKey, bodyData)
  }

  return { bodies: updatedBodies }
}
