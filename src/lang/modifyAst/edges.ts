import type { EntityReference } from '@kittycad/lib'
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
  artifactToEntityRef,
  getNodeFromPath,
  getRegionSketchTagExprFromSourceSurface,
  getRegionTagExprFromSegmentId,
  getSketchSegmentName,
  getSketchSegmentNameFromSourceSurface,
  getVariableExprsFromSelection,
  resolveToCodeRef,
  traverse,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  getArtifactFromRange,
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getCommonFacesForEdge,
  getFaceCodeRef,
  getSegmentForEdgeCut,
  getSweepArtifactFromSelection,
  getSweepFromSuspectedSweepSurface,
  type ResolvedGraphSelection,
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
  PathToNode,
  Program,
  SegmentArtifact,
  SweepArtifact,
  VariableDeclarator,
} from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import { modelingStdLibCommandName } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import {
  getBodySelectionFromPrimitiveParentEntityId,
  getEngineTopologyFallbackNormalized,
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EnginePrimitiveSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'

export function addFillet({
  ast,
  artifactGraph,
  selection,
  radius,
  tolerance,
  tag,
  version,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  selection: Selections
  radius: KclCommandValue
  tolerance?: KclCommandValue
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

  // When editing an existing fillet that already has edgeRefs, only update labeled args.
  // This avoids rebuilding from selection, which can fall back to deprecated tags/getCommonEdge.
  if (mNodeToEdit) {
    const existingResult = getNodeFromPath(
      modifiedAst,
      mNodeToEdit,
      wasmInstance,
      'CallExpressionKw'
    )
    if (!err(existingResult)) {
      const existingCall = existingResult.node as Node<CallExpressionKw>
      const hasEdgeRefs =
        findKwArg('edges', existingCall) !== undefined ||
        findKwArg('edgeRefs', existingCall) !== undefined
      if (hasEdgeRefs) {
        const newArgs = (existingCall.arguments ?? [])
          .filter((a) => getLabelName(a) !== 'tags')
          .map((a) => {
            const name = getLabelName(a)
            if (name === 'radius')
              return createLabeledArg('radius', valueOrVariable(radius))
            if (name === 'tolerance' && tolerance)
              return createLabeledArg('tolerance', valueOrVariable(tolerance))
            if (name === 'version' && version)
              return createLabeledArg('version', valueOrVariable(version))
            if (name === 'tag' && tag)
              return createLabeledArg('tag', createTagDeclarator(tag))
            return a
          })
        const call = createCallExpressionStdLibKw(
          modelingStdLibCommandName('Fillet'),
          existingCall.unlabeled,
          newArgs
        )
        const pathToNode = setCallInAst({
          ast: modifiedAst,
          call,
          pathToEdit: mNodeToEdit,
          wasmInstance,
        })
        if (err(pathToNode)) return pathToNode
        return { modifiedAst, pathToNode: [pathToNode] }
      }
    }
  }

  const edgeRefsBodyData = groupSelectionsByBodyAndCreateEdgeRefs(
    selection,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )

  let useEdgeRefs = false
  let bodyData: ReturnType<typeof groupSelectionsByBodyAndAddTags> | null = null

  if (!err(edgeRefsBodyData)) {
    useEdgeRefs = true
    modifiedAst = edgeRefsBodyData.modifiedAst
  } else {
    bodyData = groupSelectionsByBodyAndAddTags(
      selection,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      mNodeToEdit,
      { includePrimitiveEdgeIndices: true }
    )
    if (err(bodyData)) return bodyData
    modifiedAst = bodyData.modifiedAst
  }

  if ('variableName' in radius && radius.variableName) {
    insertVariableAndOffsetPathToNode(radius, modifiedAst, mNodeToEdit)
  }
  if (version && 'variableName' in version && version.variableName) {
    insertVariableAndOffsetPathToNode(version, modifiedAst, mNodeToEdit)
  }
  if (tolerance && 'variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }

  const pathToNodes: PathToNode[] = []

  if (useEdgeRefs && !err(edgeRefsBodyData)) {
    for (const data of edgeRefsBodyData.bodies.values()) {
      const tagArgs = tag
        ? [createLabeledArg('tag', createTagDeclarator(tag))]
        : []
      const toleranceArgs = tolerance
        ? [createLabeledArg('tolerance', valueOrVariable(tolerance))]
        : []
      const versionArgs = version
        ? [createLabeledArg('version', valueOrVariable(version))]
        : []
      const call = createCallExpressionStdLibKw(
        modelingStdLibCommandName('Fillet'),
        data.solidsExpr,
        [
          createLabeledArg('edges', data.edgeRefsExpr),
          createLabeledArg('radius', valueOrVariable(radius)),
          ...toleranceArgs,
          ...tagArgs,
          ...versionArgs,
        ]
      )

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
  } else if (bodyData) {
    for (const data of bodyData.bodies.values()) {
      const tagArgs = tag
        ? [createLabeledArg('tag', createTagDeclarator(tag))]
        : []
      const toleranceArgs = tolerance
        ? [createLabeledArg('tolerance', valueOrVariable(tolerance))]
        : []
      const versionArgs = version
        ? [createLabeledArg('version', valueOrVariable(version))]
        : []
      const call = createCallExpressionStdLibKw(
        modelingStdLibCommandName('Fillet'),
        data.solidsExpr,
        [
          createLabeledArg('tags', data.tagsExpr),
          createLabeledArg('radius', valueOrVariable(radius)),
          ...toleranceArgs,
          ...tagArgs,
          ...versionArgs,
        ]
      )

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

  // When editing an existing chamfer that already has edgeRefs, only update length/secondLength/angle/tag.
  if (mNodeToEdit) {
    const existingResult = getNodeFromPath(
      modifiedAst,
      mNodeToEdit,
      wasmInstance,
      'CallExpressionKw'
    )
    if (!err(existingResult)) {
      const existingCall = existingResult.node as Node<CallExpressionKw>
      const hasEdgeRefs =
        findKwArg('edges', existingCall) !== undefined ||
        findKwArg('edgeRefs', existingCall) !== undefined
      if (hasEdgeRefs) {
        const newArgs = (existingCall.arguments ?? [])
          .filter((a) => getLabelName(a) !== 'tags')
          .map((a) => {
            const name = getLabelName(a)
            if (name === 'length')
              return createLabeledArg('length', valueOrVariable(length))
            if (name === 'secondLength' && secondLength != null)
              return createLabeledArg(
                'secondLength',
                valueOrVariable(secondLength)
              )
            if (name === 'angle' && angle != null)
              return createLabeledArg('angle', valueOrVariable(angle))
            if (name === 'tag' && tag)
              return createLabeledArg('tag', createTagDeclarator(tag))
            return a
          })
        const call = createCallExpressionStdLibKw(
          'chamfer',
          existingCall.unlabeled,
          newArgs
        )
        const pathToNode = setCallInAst({
          ast: modifiedAst,
          call,
          pathToEdit: mNodeToEdit,
          wasmInstance,
        })
        if (err(pathToNode)) return pathToNode
        return { modifiedAst, pathToNode: [pathToNode] }
      }
    }
  }

  const edgeRefsBodyData = groupSelectionsByBodyAndCreateEdgeRefs(
    selection,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )

  let useEdgeRefs = false
  let bodyData: ReturnType<typeof groupSelectionsByBodyAndAddTags> | null = null

  if (!err(edgeRefsBodyData)) {
    useEdgeRefs = true
    modifiedAst = edgeRefsBodyData.modifiedAst
  } else {
    bodyData = groupSelectionsByBodyAndAddTags(
      selection,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      mNodeToEdit,
      { includePrimitiveEdgeIndices: true }
    )
    if (err(bodyData)) return bodyData
    modifiedAst = bodyData.modifiedAst
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

  const pathToNodes: PathToNode[] = []
  const secondLengthArgs = secondLength
    ? [createLabeledArg('secondLength', valueOrVariable(secondLength))]
    : []
  const angleArgs = angle
    ? [createLabeledArg('angle', valueOrVariable(angle))]
    : []
  const tagArgs = tag ? [createLabeledArg('tag', createTagDeclarator(tag))] : []

  if (useEdgeRefs && !err(edgeRefsBodyData)) {
    for (const data of edgeRefsBodyData.bodies.values()) {
      const call = createCallExpressionStdLibKw('chamfer', data.solidsExpr, [
        createLabeledArg('edges', data.edgeRefsExpr),
        createLabeledArg('length', valueOrVariable(length)),
        ...secondLengthArgs,
        ...angleArgs,
        ...tagArgs,
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
  } else if (bodyData) {
    for (const data of bodyData.bodies.values()) {
      const call = createCallExpressionStdLibKw('chamfer', data.solidsExpr, [
        createLabeledArg('tags', data.tagsExpr),
        createLabeledArg('length', valueOrVariable(length)),
        ...secondLengthArgs,
        ...angleArgs,
        ...tagArgs,
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
  const resolved = resolveToCodeRef(graphEdgeSelection, artifactGraph)
  const edgeArtifact = resolved?.artifact
  if (
    !resolved?.codeRef ||
    !edgeArtifact ||
    (edgeArtifact.type !== 'segment' && edgeArtifact.type !== 'edgeCut')
  ) {
    return new Error(
      'Blend only supports segment, edgeCut, and enginePrimitiveEdge selections.'
    )
  }
  const sourceSurfaceArtifact = getSweepArtifactFromSelection(
    resolved,
    artifactGraph
  )
  if (err(sourceSurfaceArtifact)) {
    return sourceSurfaceArtifact
  }

  const sourceSurfaceVars = getVariableExprsFromSelection(
    {
      graphSelections: [
        {
          entityRef: artifactToEntityRef('sweep', sourceSurfaceArtifact.id),
          codeRef: sourceSurfaceArtifact.codeRef,
        },
      ],
      otherSelections: [],
    },
    artifactGraph,
    ast,
    wasmInstance,
    undefined,
    { lastChildLookup: false }
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
    return {
      modifiedAst: ast,
      edgeExpr: createCallExpressionStdLibKw(
        'getBoundedEdge',
        structuredClone(sourceSurfaceExpr),
        [createLabeledArg('edge', regionSketchTagExpr)]
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
    return {
      modifiedAst: ast,
      edgeExpr: createCallExpressionStdLibKw(
        'getBoundedEdge',
        structuredClone(sourceSurfaceExpr),
        [createLabeledArg('edge', sketchTagExpr)]
      ),
    }
  }

  // Regular case
  const regularTagResult = modifyAstWithTagsForSelection(
    ast,
    resolved,
    artifactGraph,
    wasmInstance
  )
  if (err(regularTagResult) && edgeArtifact.type === 'segment') {
    const directTagResult = mutateAstWithTagForSketchSegment(
      structuredClone(ast),
      resolved.codeRef.pathToNode,
      wasmInstance
    )
    if (!err(directTagResult)) {
      return {
        modifiedAst: directTagResult.modifiedAst,
        edgeExpr: createCallExpressionStdLibKw(
          'getBoundedEdge',
          structuredClone(sourceSurfaceExpr),
          [createLabeledArg('edge', createLocalName(directTagResult.tag))]
        ),
      }
    }
  }
  if (err(regularTagResult)) return regularTagResult
  if (regularTagResult.exprs.length === 0) {
    return new Error('Expected at least one tag for each blend edge.')
  }

  const regularEdgeExpr = getEdgeTagCall(
    regularTagResult.exprs[0],
    edgeArtifact
  )

  return {
    modifiedAst: regularTagResult.modifiedAst,
    edgeExpr: createCallExpressionStdLibKw(
      'getBoundedEdge',
      structuredClone(sourceSurfaceExpr),
      [createLabeledArg('edge', regularEdgeExpr)]
    ),
  }
}

/** Set localStorage DEBUG_FILLET_SELECTION=1 for topology / groupSelectionsByBody diagnostics. */
function debugFilletTopologyLogs(): boolean {
  return (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('DEBUG_FILLET_SELECTION') === '1'
  )
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
/**
 * Converts a resolved edge selection to an EntityReference with face information.
 * This is used for the new face-based edge selection API (selectionsV2).
 */
export function edgeSelectionToEntityReference(
  selection: ResolvedGraphSelection & { artifact: Artifact },
  artifactGraph: ArtifactGraph
): EntityReference | Error {
  const artifact = selection.artifact
  // Edge artifacts are segment or edgeCut (sweepEdge removed in selectionsV2)
  let segmentArtifact: SegmentArtifact | null = null
  if (artifact.type === 'segment') {
    segmentArtifact = artifact
  } else if (artifact.type === 'edgeCut') {
    segmentArtifact = getSegmentForEdgeCut(artifact.id, artifactGraph)
  }
  if (!segmentArtifact) {
    return new Error('Selection is not an edge (segment or edgeCut)')
  }

  // Get the faces that form this edge
  const commonFaces = getCommonFacesForEdge(segmentArtifact, artifactGraph)
  if (err(commonFaces)) {
    return commonFaces
  }

  // Extract face IDs from face artifacts
  const faceIds = commonFaces.map((face) => face.id)

  if (faceIds.length === 0) {
    return new Error('No faces found for edge')
  }

  return {
    type: 'edge',
    side_faces: faceIds,
  }
}

/**
 * Type alias for EdgeRef payload used in KCL edgeRefs array
 */
type FilletEdgeRefPayload = {
  side_faces: string[]
  end_faces?: string[]
  index?: number
}

/**
 * Converts an EntityReference (edge type) to a KCL edgeRefs payload object.
 * Only includes optional fields when they are actually present.
 */
export function entityReferenceToEdgeRefPayload(
  entityRef: Extract<EntityReference, { type: 'edge' }>
): FilletEdgeRefPayload {
  const payload: FilletEdgeRefPayload = {
    side_faces: entityRef.side_faces,
  }

  if (entityRef.end_faces && entityRef.end_faces.length > 0) {
    payload.end_faces = entityRef.end_faces
  }

  if (entityRef.index !== undefined) {
    payload.index = entityRef.index
  }

  return payload
}

/**
 * Creates KCL object expression for an edgeRef payload.
 * Resolves face UUIDs to tags by looking up artifacts and getting/creating tags.
 * @param originalEdgeSelection - Optional original edge selection for Solid2D edge handling
 * @param fallbackCodeRef - Optional codeRef to use when originalEdgeSelection is not available (for SelectionV2-only rows)
 * @param tagsBaseExpr - When original tags were referenced as base.tags.x (e.g. bs.tags.edge7), pass the base expr so we emit sideFaces = [base.tags.edge6, base.tags.edge7]
 */
export function createEdgeRefObjectExpression(
  payload: FilletEdgeRefPayload,
  wasmInstance: ModuleType,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  originalEdgeSelection?: ResolvedGraphSelection,
  fallbackCodeRef?: CodeRef,
  tagsBaseExpr?: Expr | null,
  owningBodyExpr?: Expr | null
): { expr: Expr; modifiedAst: Node<Program> } | Error {
  const sideFaceExprs: Expr[] = []
  let currentAst = ast
  const effectiveTagsBaseExpr =
    tagsBaseExpr && tagsBaseMatchesOwningBody(tagsBaseExpr, owningBodyExpr)
      ? tagsBaseExpr
      : tagsBaseExpr && owningBodyExpr
        ? createMemberExpression(structuredClone(owningBodyExpr), 'sketch')
        : null

  const applyTagsBaseExprIfNeeded = (
    expr: Expr,
    faceArtifact: Artifact
  ): Expr => {
    if (
      effectiveTagsBaseExpr != null &&
      expr.type === 'Name' &&
      faceArtifact.type !== 'cap'
    ) {
      return createMemberExpression(
        createMemberExpression(structuredClone(effectiveTagsBaseExpr), 'tags'),
        expr.name?.name ?? ''
      )
    }
    if (
      effectiveTagsBaseExpr != null &&
      expr.type === 'Name' &&
      faceArtifact.type === 'cap'
    ) {
      const bodyExpr = getBodyExprFromSketchTagsBaseExpr(effectiveTagsBaseExpr)
      if (bodyExpr) {
        return createMemberExpression(
          createMemberExpression(bodyExpr, 'faces'),
          expr.name?.name ?? ''
        )
      }
    }
    return structuredClone(expr)
  }

  const getExistingSketchTagExprForFace = (
    faceArtifact: Artifact
  ): Expr | null => {
    if (effectiveTagsBaseExpr == null || faceArtifact.type !== 'wall') {
      return null
    }

    const segment = getArtifactOfTypes(
      { key: faceArtifact.segId, types: ['segment'] },
      artifactGraph
    )
    if (err(segment)) return null

    const segmentName = getSketchSegmentName(
      currentAst,
      segment.originalSegId ?? segment.id,
      artifactGraph,
      wasmInstance
    )
    if (!segmentName) return null

    return createMemberExpression(
      createMemberExpression(structuredClone(effectiveTagsBaseExpr), 'tags'),
      segmentName
    )
  }

  for (const faceId of payload.side_faces) {
    const faceArtifact = artifactGraph.get(faceId)
    if (!faceArtifact) {
      return new Error(
        `Could not find artifact for face ${faceId} in edge reference`
      )
    }

    const codeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      return new Error(
        `Could not find codeRefs for face ${faceId} in edge reference`
      )
    }

    // Handle Solid2D case: for Solid2D profiles, the "face" is actually the Solid2D itself
    // We need to tag the segment directly instead of trying to tag the face
    const existingSketchTagExpr = getExistingSketchTagExprForFace(faceArtifact)
    if (existingSketchTagExpr) {
      sideFaceExprs.push(existingSketchTagExpr)
      continue
    }

    // Handle Solid2D case: for Solid2D profiles, the "face" is actually the Solid2D itself
    // We need to tag the segment directly instead of trying to tag the face
    if (faceArtifact.type === 'solid2d') {
      const segmentArtifact =
        originalEdgeSelection?.artifact?.type === 'segment'
          ? originalEdgeSelection.artifact
          : fallbackCodeRef?.range
            ? getArtifactFromRange(
                fallbackCodeRef.range,
                artifactGraph,
                'segment'
              )
            : null
      if (segmentArtifact?.type === 'segment') {
        const regionTagExpr = getRegionTagExprFromSegmentId(
          currentAst,
          segmentArtifact.id,
          artifactGraph,
          wasmInstance
        )
        if (regionTagExpr) {
          sideFaceExprs.push(regionTagExpr)
          continue
        }
      }

      // For Solid2D edges, use the original edge selection or SelectionV2 codeRef to tag the segment.
      let segmentPathToNode: PathToNode | undefined

      if (
        originalEdgeSelection?.artifact &&
        originalEdgeSelection.artifact.type === 'segment'
      ) {
        // Use the segment artifact's codeRef
        segmentPathToNode = originalEdgeSelection.artifact.codeRef.pathToNode
      } else if (fallbackCodeRef?.pathToNode) {
        // Use the provided codeRef from the SelectionV2 row.
        segmentPathToNode = fallbackCodeRef.pathToNode
      } else if (codeRefs[0]?.pathToNode) {
        // Last resort: use the codeRef from the Solid2D (points to the profile, but we can try to find the segment)
        // This is less ideal but might work if the segment is in the same path
        segmentPathToNode = codeRefs[0].pathToNode
      }

      if (!segmentPathToNode || segmentPathToNode.length === 0) {
        return new Error(
          `Cannot create tag for Solid2D edge ${faceId}: could not find segment pathToNode. Original edge selection or codeRef is required.`
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
      // Normal case: tag the face artifact
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
      const endFaceArtifact = artifactGraph.get(faceId)
      if (!endFaceArtifact) continue
      const codeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
      if (!codeRefs?.length) continue

      const tagResult = modifyAstWithTagsForSelection(
        currentAst,
        {
          artifact: endFaceArtifact,
          codeRef: codeRefs[0],
        },
        artifactGraph,
        wasmInstance
      )
      if (err(tagResult)) {
        continue
      }

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

  // Only add index if explicitly provided
  if (payload.index !== undefined) {
    properties.index = createLiteral(payload.index, wasmInstance)
  }

  // Create object expression (KCL object literal)
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
  if (tagsArg.arg.type === 'ArrayExpression')
    return tagsArg.arg.elements ?? null
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
  if (!edgeRefsArg?.arg || edgeRefsArg.arg.type !== 'ArrayExpression') return []
  return edgeRefsArg.arg.elements ?? []
}

/**
 * If the tag element is a deprecated stdlib call whose first argument is base.tags.tagName
 * (e.g. getPreviousAdjacentEdge(bs.tags.edge7)), returns the base expression (e.g. bs).
 * Used so Z0006 refactor can emit edgeRefs with the same style: sideFaces = [bs.tags.edge6, bs.tags.edge7].
 */
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

function getBodyExprFromSketchTagsBaseExpr(tagsBaseExpr: Expr): Expr | null {
  if (tagsBaseExpr.type !== 'MemberExpression') return null
  const propName =
    tagsBaseExpr.property.type === 'Name'
      ? tagsBaseExpr.property.name.name
      : undefined
  if (propName !== 'sketch') return null
  return tagsBaseExpr.object
}

function tagsBaseMatchesOwningBody(
  tagsBaseExpr: Expr,
  owningBodyExpr?: Expr | null
): boolean {
  if (!owningBodyExpr) return true
  const bodyExpr = getBodyExprFromSketchTagsBaseExpr(tagsBaseExpr)
  if (!bodyExpr) return true
  return exprPathKey(bodyExpr) === exprPathKey(owningBodyExpr)
}

function exprPathKey(expr: Expr): string | null {
  if (expr.type === 'Name') return expr.name.name
  if (expr.type !== 'MemberExpression') return null

  const objectKey = exprPathKey(expr.object)
  const propertyName =
    expr.property.type === 'Name' ? expr.property.name.name : null
  if (!objectKey || !propertyName) return null
  return `${objectKey}.${propertyName}`
}

function getTagInfoFromExpr(
  expr: Expr
): { tagName: string; tagsBaseExpr: Expr | null } | null {
  if (expr.type === 'Name') {
    return { tagName: expr.name.name, tagsBaseExpr: null }
  }

  if (expr.type !== 'MemberExpression') return null

  const propertyName =
    expr.property.type === 'Name' ? expr.property.name.name : undefined
  if (!propertyName) return null

  if (expr.object.type !== 'MemberExpression') {
    return null
  }
  const tagsMember = expr.object
  const tagsPropName =
    tagsMember.property.type === 'Name'
      ? tagsMember.property.name.name
      : undefined
  if (tagsPropName !== 'tags') return null

  return {
    tagName: propertyName,
    tagsBaseExpr: tagsMember.object,
  }
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

function hasFaceIds(
  meta: EdgeRefactorMeta | undefined
): meta is EdgeRefactorMeta & { faceIds: [string, string] } {
  return isArray(meta?.faceIds) && meta.faceIds.length === 2
}

interface ExprWalkOptions {
  resolveWrappedCalls?: boolean
  includeCallUnlabeled?: boolean
}

type ExprVisitor = (
  expr: Expr,
  pathPrefix: PathToNode | undefined,
  walk: (expr: Expr, pathPrefix?: PathToNode) => void
) => void

function visitExpr(
  expr: Expr,
  visitor: ExprVisitor,
  options: ExprWalkOptions,
  pathPrefix?: PathToNode
): void {
  const walk = (nextExpr: Expr, nextPathPrefix = pathPrefix) =>
    walkExpr(nextExpr, visitor, options, nextPathPrefix)
  visitor(expr, pathPrefix, walk)
}

function walkExpr(
  expr: Expr,
  visitor: ExprVisitor,
  options: ExprWalkOptions,
  pathPrefix?: PathToNode
): void {
  if (!expr || typeof expr !== 'object') return

  if (expr.type === 'PipeExpression') {
    for (const bodyExpr of expr.body ?? []) {
      visitExpr(bodyExpr, visitor, options, pathPrefix)
    }
    return
  }

  const callExpr = options.resolveWrappedCalls
    ? getCallFromExpr(expr)
    : expr.type === 'CallExpressionKw'
      ? expr
      : null
  if (callExpr) {
    if (options.includeCallUnlabeled && callExpr.unlabeled) {
      visitExpr(callExpr.unlabeled, visitor, options, pathPrefix)
    }
    for (const arg of callExpr.arguments ?? []) {
      visitExpr(arg.arg, visitor, options, pathPrefix)
    }
    return
  }

  if (expr.type === 'BinaryExpression') {
    if (expr.left) walkExpr(expr.left, visitor, options, pathPrefix)
    if (expr.right) walkExpr(expr.right, visitor, options, pathPrefix)
    return
  }
  if (expr.type === 'ArrayExpression') {
    for (const element of expr.elements ?? []) {
      walkExpr(element, visitor, options, pathPrefix)
    }
    return
  }
  if (expr.type === 'ObjectExpression') {
    for (const property of expr.properties ?? []) {
      walkExpr(property.value, visitor, options, pathPrefix)
    }
    return
  }
  if (expr.type === 'LabelledExpression') {
    visitExpr(expr.expr, visitor, options, pathPrefix)
  } else if (expr.type === 'AscribedExpression') {
    visitExpr(expr.expr, visitor, options, pathPrefix)
  } else if (expr.type === 'UnaryExpression') {
    walkExpr(expr.argument, visitor, options, pathPrefix)
  } else if (expr.type === 'MemberExpression') {
    walkExpr(expr.object, visitor, options, pathPrefix)
    walkExpr(expr.property, visitor, options, pathPrefix)
  } else if (expr.type === 'FunctionExpression') {
    visitProgramExpressions(expr.body, visitor, options, [
      ...(pathPrefix ?? []),
      ['body', 'FunctionExpression'],
    ])
  }
}

function visitProgramExpressions(
  program: Program,
  visitor: ExprVisitor,
  options: ExprWalkOptions,
  pathPrefix: PathToNode = []
): void {
  const body = program.body ?? []
  for (let statementIndex = 0; statementIndex < body.length; statementIndex++) {
    const item = body[statementIndex]
    const statementPathPrefix: PathToNode = [
      ...pathPrefix,
      ['body', ''],
      [statementIndex, 'index'],
    ]
    if (item.type === 'VariableDeclaration' && item.declaration?.init) {
      visitExpr(item.declaration.init, visitor, options, [
        ...statementPathPrefix,
        ['declaration', 'VariableDeclaration'],
        ['init', ''],
      ])
    } else if (item.type === 'ExpressionStatement' && item.expression) {
      visitExpr(item.expression, visitor, options, [
        ...statementPathPrefix,
        ['expression', 'ExpressionStatement'],
      ])
    } else if (item.type === 'ReturnStatement' && item.argument) {
      visitExpr(item.argument, visitor, options, [
        ...statementPathPrefix,
        ['argument', 'ReturnStatement'],
      ])
    }
  }
}

type Z0006SourceRange = [number, number, number]

function sourceRangesOverlap(
  a: Z0006SourceRange,
  b: Z0006SourceRange
): boolean {
  return a[2] === b[2] && a[0] < b[1] && b[0] < a[1]
}

function filterCallsBySourceRange<
  T extends { range: Z0006SourceRange; triggerRanges?: Z0006SourceRange[] },
>(calls: T[], sourceRange?: Z0006SourceRange): T[] {
  if (!sourceRange) return calls
  return calls.filter(
    (call) =>
      sourceRangesOverlap(call.range, sourceRange) ||
      call.triggerRanges?.some((range) =>
        sourceRangesOverlap(range, sourceRange)
      )
  )
}

interface UnifiedCallToFix {
  range: Z0006SourceRange
  triggerRanges?: Z0006SourceRange[]
  orderedPayloads: FilletEdgeRefPayload[]
  orderedEdgeRefExprs: Expr[]
  hasExistingEdgeRefs: boolean
  tagsBaseExpr?: Expr | null
  owningBodyExpr?: Expr | null
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
  program: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  directTagFilletMetadata: DirectTagFilletMeta[],
  artifactGraph: ArtifactGraph
): UnifiedCallToFix[] {
  const results: UnifiedCallToFix[] = []

  const processExpr: ExprVisitor = (expr, pathPrefix, walk) => {
    if (expr.type !== 'CallExpressionKw') {
      walk(expr)
      return
    }
    const call = expr
    const calleeName = getCalleeName(call)
    if (!calleeName || !isFilletOrChamfer(calleeName)) {
      walk(expr)
      return
    }
    const elements = getTagsElementsFromCall(call)
    const existingEdgeRefExprs = getExistingEdgeRefsFromCall(call)
    const orderedPayloads: FilletEdgeRefPayload[] = []
    const orderedEdgeRefExprs: Expr[] = []
    const triggerRanges: Z0006SourceRange[] = []
    let tagsBaseExpr: Expr | null = null
    let hasUnconvertedTagsElement = false

    if (elements?.length) {
      for (const el of elements) {
        if (tagsBaseExpr === null) {
          const base = getTagsBaseFromTagElement(el)
          if (base !== null) tagsBaseExpr = base
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
            if (hasFaceIds(meta)) {
              triggerRanges.push([inner.start, inner.end, inner.moduleId])
              orderedPayloads.push({
                side_faces: meta.faceIds,
              })
            } else {
              hasUnconvertedTagsElement = true
            }
          } else {
            hasUnconvertedTagsElement = true
          }
          continue
        }

        const tagInfo = getTagInfoFromExpr(el)
        if (!tagInfo) {
          hasUnconvertedTagsElement = true
          continue
        }
        if (tagsBaseExpr === null && tagInfo.tagsBaseExpr) {
          tagsBaseExpr = tagInfo.tagsBaseExpr
        }
        const moduleId = call.moduleId
        const directMeta = directTagFilletMetadata.find((m) =>
          callSourceRangeMatches(m, call.start, call.end, moduleId)
        )
        const tagEntry = directMeta?.tags?.find(
          (t: { tagIdentifier: string }) => t.tagIdentifier === tagInfo.tagName
        )
        if (tagEntry) {
          orderedPayloads.push({ side_faces: tagEntry.faceIds })
          continue
        }

        const deprecatedCall = findDeprecatedEdgeStdlibCallForVariable(
          program,
          tagInfo.tagName,
          pathPrefix ?? []
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
          if (hasFaceIds(meta)) {
            triggerRanges.push([
              deprecatedCall.call.start,
              deprecatedCall.call.end,
              deprecatedCall.call.moduleId,
            ])
            orderedPayloads.push({
              side_faces: meta.faceIds,
            })
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
        triggerRanges,
        orderedPayloads,
        orderedEdgeRefExprs,
        hasExistingEdgeRefs: existingEdgeRefExprs.length > 0,
        tagsBaseExpr: tagsBaseExpr ?? undefined,
        owningBodyExpr: call.unlabeled
          ? structuredClone(call.unlabeled)
          : undefined,
      })
    }

    walk(expr)
  }

  visitProgramExpressions(program, processExpr, { includeCallUnlabeled: true })

  return results
}

interface RevolveHelixCallToFix {
  range: Z0006SourceRange
  faceIds: [string, string]
  /** When range is 0,0 we use this path to find the call (fallback). */
  pathToCall?: PathToNode
}

/** One entry per extrude call that has to = deprecated stdlib (e.g. getCommonEdge). */
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

interface BoundedEdgeCallToFix {
  range: Z0006SourceRange
  payload: FilletEdgeRefPayload
  pathToCall?: PathToNode
}

function getCallFromExpr(expr: Expr): Node<CallExpressionKw> | null {
  if (!expr || typeof expr !== 'object') return null
  if (expr.type === 'CallExpressionKw') return expr
  return null
}

function getCallPathFromExpr(
  expr: Expr,
  pathPrefix?: PathToNode
): PathToNode | undefined {
  if (!pathPrefix?.length) return undefined
  if (expr.type === 'CallExpressionKw') return [...pathPrefix]
  return undefined
}

/** Exported for tests: find revolve/helic calls with deprecated axis to fix. */
export function findRevolveHelixCallsToFix(
  program: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[]
): RevolveHelixCallToFix[] {
  const results: RevolveHelixCallToFix[] = []

  const processExpr: ExprVisitor = (expr, pathPrefix, walk) => {
    const call = getCallFromExpr(expr)
    if (!call) {
      walk(expr)
      return
    }
    const callPath = getCallPathFromExpr(expr, pathPrefix)
    const calleeName = getCalleeName(call)
    if (!calleeName || !isRevolveOrHelix(calleeName)) {
      walk(expr)
      return
    }
    const axisArg = findKwArg('axis', call)
    const inner = axisArg ? getCallFromExpr(axisArg) : null
    if (!inner) {
      walk(expr)
      return
    }
    const innerCallee = getCalleeName(inner)
    if (!isDeprecatedEdgeStdlib(innerCallee)) {
      walk(expr)
      return
    }

    const innerStart = inner.start
    const innerEnd = inner.end
    const innerModuleId = inner.moduleId
    const meta = edgeRefactorMetadata.find((m) =>
      sourceRangeMatch(m, innerStart, innerEnd, innerModuleId)
    )
    const moduleId = call.moduleId
    const callStart = call.start
    const callEnd = call.end
    if (hasFaceIds(meta)) {
      results.push({
        range: [callStart, callEnd, moduleId],
        faceIds: [meta.faceIds[0], meta.faceIds[1]],
        pathToCall: callPath,
      })
    }
    walk(expr)
  }

  visitProgramExpressions(program, processExpr, {
    resolveWrappedCalls: true,
    includeCallUnlabeled: true,
  })

  return results
}

/** findKwArg for a call's arguments. */
function findToArg(call: Node<CallExpressionKw>): Expr | null {
  const arg = call.arguments?.find((a) => getLabelName(a) === 'to')
  return arg?.arg ?? null
}

/**
 * Find extrude calls whose `to` argument is a deprecated stdlib call (getCommonEdge, getOppositeEdge, etc.).
 * Used by Z0006 refactor to replace `to = getCommonEdge(...)` with `to = { sideFaces = [...] }`.
 */
export function findExtrudeToCallsToFix(
  program: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[]
): ExtrudeToCallToFix[] {
  const results: ExtrudeToCallToFix[] = []

  const processExpr: ExprVisitor = (expr, pathPrefix, walk) => {
    const call = getCallFromExpr(expr)
    if (!call) {
      walk(expr)
      return
    }
    const callPath = getCallPathFromExpr(expr, pathPrefix)
    const calleeName = getCalleeName(call)
    if (!calleeName || !isExtrude(calleeName)) {
      walk(expr)
      return
    }
    const toArg = findToArg(call)
    const inner = toArg ? getCallFromExpr(toArg) : null
    if (!inner) {
      walk(expr)
      return
    }
    const innerCallee = getCalleeName(inner)
    if (!isDeprecatedEdgeStdlib(innerCallee)) {
      walk(expr)
      return
    }

    const innerStart = inner.start
    const innerEnd = inner.end
    const innerModuleId = inner.moduleId
    const meta = edgeRefactorMetadata.find((m) =>
      sourceRangeMatch(m, innerStart, innerEnd, innerModuleId)
    )
    const moduleId = call.moduleId
    const callStart = call.start
    const callEnd = call.end
    if (hasFaceIds(meta)) {
      results.push({
        range: [callStart, callEnd, moduleId],
        faceIds: [meta.faceIds[0], meta.faceIds[1]],
        pathToCall: callPath,
      })
    }
    walk(expr)
  }

  visitProgramExpressions(program, processExpr, {
    resolveWrappedCalls: true,
    includeCallUnlabeled: true,
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
        if (!hasFaceIds(meta)) {
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
        if (!hasFaceIds(meta)) continue

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

export function findBoundedEdgeCallsToFix(
  program: Node<Program>,
  edgeRefactorMetadata: EdgeRefactorMeta[]
): BoundedEdgeCallToFix[] {
  const results: BoundedEdgeCallToFix[] = []

  traverse(program, {
    enter(node, pathToNode) {
      if (node.type !== 'CallExpressionKw') return

      const call = node
      const calleeName = getCalleeName(call)
      if (calleeName !== 'getBoundedEdge') return

      const edgeArg = call.arguments?.find((a) => getLabelName(a) === 'edge')
      if (!edgeArg?.arg) return

      const inner = getCallFromExpr(edgeArg.arg)
      if (!inner) return

      const innerCallee = getCalleeName(inner)
      if (!isDeprecatedEdgeStdlib(innerCallee)) return

      const meta = edgeRefactorMetadata.find((m) =>
        sourceRangeMatch(m, inner.start, inner.end, inner.moduleId)
      )
      if (!hasFaceIds(meta)) return

      results.push({
        range: [call.start, call.end, call.moduleId],
        payload: {
          side_faces: meta.faceIds,
        },
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
  for (let i = 0; i < toFix.length; i++) {
    const { faceIds, pathToCall } = toFix[i]
    const path = pathToCall && pathToCall.length > 0 ? pathToCall : pathList[i]
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

/**
 * Refactor extrude calls that use deprecated `to` (e.g. to = getCommonEdge(...))
 * to to = { sideFaces = [...] }. Mutates modifiedAst in place.
 */
function refactorExtrudeToToEdgeSpecifierInPlace(
  modifiedAst: Node<Program>,
  toFix: ExtrudeToCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  if (toFix.length === 0) return modifiedAst
  for (let i = 0; i < toFix.length; i++) {
    const { faceIds, pathToCall } = toFix[i]
    const path = pathToCall && pathToCall.length > 0 ? pathToCall : pathList[i]
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

function isNodeProgram(ast: Program): ast is Node<Program> {
  return (
    'start' in ast &&
    typeof ast.start === 'number' &&
    'end' in ast &&
    typeof ast.end === 'number' &&
    'moduleId' in ast &&
    typeof ast.moduleId === 'number' &&
    'commentStart' in ast &&
    typeof ast.commentStart === 'number'
  )
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

function refactorBoundedEdgeEdgeArgToEdgeSpecifierInPlace(
  modifiedAst: Node<Program>,
  toFix: BoundedEdgeCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  if (toFix.length === 0) return modifiedAst

  for (let index = 0; index < toFix.length; index++) {
    const { payload, pathToCall } = toFix[index]
    const path = pathToCall?.length ? pathToCall : pathList[index]
    const result = createEdgeRefObjectExpression(
      payload,
      wasmInstance,
      modifiedAst,
      artifactGraph
    )
    if (err(result)) continue

    const nextAst = result.modifiedAst
    const nodeResult = getNodeFromPath<Node<CallExpressionKw>>(
      nextAst,
      path,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(nodeResult)) continue

    const callNode = nodeResult.node
    const newArgs = (callNode.arguments ?? []).filter(
      (a) => getLabelName(a) !== 'edge'
    )
    newArgs.push(createLabeledArg('edge', result.expr))
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
  const toFixFC = filterCallsBySourceRange(
    findFilletChamferCallsToFixUnified(
      ast,
      edgeRefactorMetadata,
      directTagFilletMetadata,
      artifactGraph
    ),
    sourceRange
  )
  const toFixRH = filterCallsBySourceRange(
    findRevolveHelixCallsToFix(ast, edgeRefactorMetadata),
    sourceRange
  )
  const toFixET = filterCallsBySourceRange(
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
  const toFixBoundedEdge = filterCallsBySourceRange(
    findBoundedEdgeCallsToFix(ast, edgeRefactorMetadata),
    sourceRange
  )
  if (
    toFixFC.length === 0 &&
    toFixRH.length === 0 &&
    toFixET.length === 0 &&
    toFixGdtEdges.length === 0 &&
    toFixGdtDistanceEndpoints.length === 0 &&
    toFixBoundedEdge.length === 0
  ) {
    return new Error('No Z0006 fixes to apply')
  }
  if (!isNodeProgram(ast)) {
    return new Error('Expected AST node metadata for Z0006 refactor')
  }

  let modifiedAst = structuredClone(ast)
  let appliedFilletChamferFix = false

  for (const {
    range,
    orderedPayloads,
    orderedEdgeRefExprs,
    hasExistingEdgeRefs,
    tagsBaseExpr,
    owningBodyExpr,
  } of toFixFC) {
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
        tagsBaseExpr,
        owningBodyExpr
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
      const existing = getExistingEdgeRefsFromCall(callNode)
      edgeRefExprs.push(...existing)
    }
    if (edgeRefExprs.length === 0) continue
    const args = callNode.arguments ?? []
    const newArgs = args.filter(
      (a) =>
        getLabelName(a) !== 'tags' &&
        getLabelName(a) !== 'edges' &&
        getLabelName(a) !== 'edgeRefs'
    )
    newArgs.push(createLabeledArg('edges', createArrayExpression(edgeRefExprs)))
    callNode.arguments = newArgs
    modifiedAst = nextAst
    appliedFilletChamferFix = true
  }

  if (
    toFixFC.length > 0 &&
    !appliedFilletChamferFix &&
    toFixRH.length === 0 &&
    toFixET.length === 0 &&
    toFixGdtEdges.length === 0 &&
    toFixGdtDistanceEndpoints.length === 0
  ) {
    return new Error('No Z0006 fixes to apply')
  }

  const pathListRH = toFixRH.map((t) =>
    t.pathToCall && t.pathToCall.length > 0
      ? t.pathToCall
      : getNodePathFromSourceRange(ast, t.range)
  )
  modifiedAst = refactorRevolveHelixAxisToEdgeRefInPlace(
    modifiedAst,
    toFixRH,
    pathListRH,
    artifactGraph,
    wasmInstance
  )

  const pathListET = toFixET.map((t) =>
    t.pathToCall && t.pathToCall.length > 0
      ? t.pathToCall
      : getNodePathFromSourceRange(ast, t.range)
  )
  modifiedAst = refactorExtrudeToToEdgeSpecifierInPlace(
    modifiedAst,
    toFixET,
    pathListET,
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

  modifiedAst = refactorBoundedEdgeEdgeArgToEdgeSpecifierInPlace(
    modifiedAst,
    toFixBoundedEdge,
    toFixBoundedEdge.map((item) =>
      item.pathToCall?.length
        ? item.pathToCall
        : getNodePathFromSourceRange(ast, item.range)
    ),
    artifactGraph,
    wasmInstance
  )

  return recast(modifiedAst, wasmInstance)
}

/**
 * Groups edge selections by body and creates edgeRefs expressions.
 * Uses graphSelections if available, otherwise converts graphSelections to EntityReferences.
 */
function groupSelectionsByBodyAndCreateEdgeRefs(
  selections: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode,
  _options?: { includePrimitiveEdgeIndices?: boolean }
):
  | {
      modifiedAst: Node<Program>
      bodies: Map<
        string,
        {
          solidsExpr: Expr | null
          edgeRefsExpr: Expr
          pathIfPipe?: PathToNode
        }
      >
    }
  | Error {
  let modifiedAst = ast
  const bodies = new Map<
    string,
    {
      solidsExpr: Expr | null
      edgeRefsExpr: Expr
      pathIfPipe?: PathToNode
    }
  >()

  const v2Selections = selections.graphSelections || []
  const hasV2Selections = v2Selections.length > 0

  if (hasV2Selections) {
    // V2-only path: Group V2 selections by body using face IDs
    const bodyToV2Selections = new Map<
      string,
      {
        sweepArtifact: SweepArtifact
        edgeEntityRefs: Array<Extract<EntityReference, { type: 'edge' }>>
      }
    >()

    for (const v2Sel of v2Selections) {
      const resolved = resolveToCodeRef(v2Sel, artifactGraph)
      if (!resolved?.artifact) continue

      // Convert segment/edgeCut selections into the V2 `edge` entityRef shape
      // expected by edgeRef payload creation.
      const edgeEntityRef:
        | Extract<EntityReference, { type: 'edge' }>
        | undefined =
        v2Sel.entityRef?.type === 'edge'
          ? v2Sel.entityRef
          : (() => {
              const er = edgeSelectionToEntityReference(
                {
                  ...resolved,
                  artifact: resolved.artifact,
                },
                artifactGraph
              )
              return err(er)
                ? undefined
                : (er as Extract<EntityReference, { type: 'edge' }>)
            })()

      if (!edgeEntityRef) continue

      // Find a face artifact that ties this edge to a sweep (wall/cap/edgeCut/primitiveFace).
      // Shell and inner edges may not use only wall/cap in the graph; fall back via sweep surface resolution.
      let faceArtifact: Artifact | undefined
      for (const faceId of edgeEntityRef.side_faces) {
        const a = artifactGraph.get(faceId)
        if (
          a &&
          (a.type === 'wall' ||
            a.type === 'cap' ||
            a.type === 'edgeCut' ||
            a.type === 'primitiveFace')
        ) {
          faceArtifact = a
          break
        }
      }
      if (!faceArtifact) {
        for (const faceId of edgeEntityRef.side_faces) {
          const sweepTry = getSweepFromSuspectedSweepSurface(
            faceId,
            artifactGraph
          )
          if (!err(sweepTry)) {
            const a = artifactGraph.get(faceId)
            if (a) {
              faceArtifact = a
              break
            }
          }
        }
      }
      if (!faceArtifact) continue

      const faceCodeRef =
        getFaceCodeRef(faceArtifact) ??
        getCodeRefsByArtifactId(faceArtifact.id, artifactGraph)?.[0]
      if (!faceCodeRef) continue

      const sweepArtifact = getSweepArtifactFromSelection(
        { artifact: faceArtifact, codeRef: faceCodeRef },
        artifactGraph
      )
      if (err(sweepArtifact)) continue

      const bodyKey = JSON.stringify(sweepArtifact.codeRef.pathToNode)
      if (!bodyToV2Selections.has(bodyKey)) {
        bodyToV2Selections.set(bodyKey, {
          sweepArtifact,
          edgeEntityRefs: [],
        })
      }
      bodyToV2Selections.get(bodyKey)!.edgeEntityRefs.push(edgeEntityRef)
    }

    // Process each body
    for (const [bodyKey, bodyData] of bodyToV2Selections.entries()) {
      const bodyEdgeRefs: Expr[] = []

      // Create edgeRefs from V2 selections
      for (const edgeEntityRef of bodyData.edgeEntityRefs) {
        const payload = entityReferenceToEdgeRefPayload(edgeEntityRef)
        const result = createEdgeRefObjectExpression(
          payload,
          wasmInstance,
          modifiedAst,
          artifactGraph
        )
        if (err(result)) {
          console.warn('Failed to create edgeRef expression:', result)
          continue
        }
        bodyEdgeRefs.push(result.expr)
        modifiedAst = result.modifiedAst
      }

      if (bodyEdgeRefs.length === 0) continue

      // Build solids expression
      const solids: Selections = {
        graphSelections: [
          {
            entityRef: artifactToEntityRef('sweep', bodyData.sweepArtifact.id),
            codeRef: bodyData.sweepArtifact.codeRef,
          },
        ],
        otherSelections: [],
      }

      const vars = getVariableExprsFromSelection(
        solids,
        artifactGraph,
        modifiedAst,
        wasmInstance,
        nodeToEdit,
        { lastChildLookup: true }
      )
      if (err(vars)) return vars

      const solidsExpr = createVariableExpressionsArray(vars.exprs)
      const edgeRefsExpr = createArrayExpression(bodyEdgeRefs)

      bodies.set(bodyKey, {
        solidsExpr,
        edgeRefsExpr,
        pathIfPipe: vars.pathIfPipe,
      })
    }
  } else {
    // V1 path or mixed: Group selections by body first (same logic as tags path)
    const selectionsByBody = groupSelectionsByBody(selections, artifactGraph)
    if (err(selectionsByBody)) return selectionsByBody

    for (const [bodyKey, bodySelections] of selectionsByBody.entries()) {
      // Get edgeRefs for edges in this body
      // Prefer V2 selections if available, otherwise convert V1
      const bodyEdgeRefs: Expr[] = []

      // Check if we have V2 selections for this body
      const v2ForBody = v2Selections.filter((sel) => {
        if (!sel.entityRef || sel.entityRef.type !== 'edge') return false
        return bodySelections.graphSelections.some(
          (bs: Selection) => bs.codeRef?.pathToNode === sel.codeRef?.pathToNode
        )
      })

      if (v2ForBody.length > 0) {
        // Use V2 selections directly
        for (const v2Sel of v2ForBody) {
          if (v2Sel.entityRef?.type === 'edge') {
            const payload = entityReferenceToEdgeRefPayload(v2Sel.entityRef)
            const result = createEdgeRefObjectExpression(
              payload,
              wasmInstance,
              modifiedAst,
              artifactGraph
            )
            if (err(result)) {
              console.warn('Failed to create edgeRef expression:', result)
              continue
            }
            bodyEdgeRefs.push(result.expr)
            modifiedAst = result.modifiedAst
          }
        }
      } else {
        // Resolve V2 selections and convert to EntityReferences
        for (const v2Sel of bodySelections.graphSelections) {
          const resolved = resolveToCodeRef(v2Sel, artifactGraph)
          if (!resolved?.artifact) continue
          const entityRef = edgeSelectionToEntityReference(
            { codeRef: resolved.codeRef, artifact: resolved.artifact },
            artifactGraph
          )
          if (err(entityRef) || entityRef.type !== 'edge') {
            continue
          }

          const payload = entityReferenceToEdgeRefPayload(entityRef)
          const result = createEdgeRefObjectExpression(
            payload,
            wasmInstance,
            modifiedAst,
            artifactGraph
          )
          if (err(result)) {
            console.warn('Failed to create edgeRef expression:', result)
            continue
          }
          bodyEdgeRefs.push(result.expr)
          modifiedAst = result.modifiedAst
        }
      }

      if (bodyEdgeRefs.length === 0) {
        continue
      }

      // Build solids expression (same as in groupSelectionsByBodyAndAddTags)
      const firstResolved = bodySelections.graphSelections[0]
        ? resolveToCodeRef(bodySelections.graphSelections[0], artifactGraph)
        : null
      if (!firstResolved) continue
      const sweep = getSweepArtifactFromSelection(firstResolved, artifactGraph)
      if (err(sweep)) continue
      const solids: Selections = {
        graphSelections: [
          {
            entityRef: artifactToEntityRef('sweep', sweep.id),
            codeRef: sweep.codeRef,
          },
        ],
        otherSelections: [],
      }

      const vars = getVariableExprsFromSelection(
        solids,
        artifactGraph,
        modifiedAst,
        wasmInstance,
        nodeToEdit,
        { lastChildLookup: true }
      )
      if (err(vars)) return vars

      const solidsExpr = createVariableExpressionsArray(vars.exprs)
      const edgeRefsExpr = createArrayExpression(bodyEdgeRefs)

      bodies.set(bodyKey, {
        solidsExpr,
        edgeRefsExpr,
        pathIfPipe: vars.pathIfPipe,
      })
    }
  }

  if (bodies.size === 0) {
    return new Error('No edge selections found')
  }

  return { modifiedAst, bodies }
}

type EdgeSelectionForExpr = Selection | EnginePrimitiveSelection
type BodySelectionData = {
  solidsExpr: Expr | null
  tagsExpr: Expr
  pathIfPipe?: PathToNode
}

function getEdgeSelections(edges: Selections): EdgeSelectionForExpr[] {
  return [
    ...edges.graphSelections,
    ...edges.otherSelections.filter(
      (selection): selection is EnginePrimitiveSelection =>
        isEnginePrimitiveSelection(selection) &&
        selection.primitiveType === 'edge'
    ),
  ]
}

// Utility functions

/**
 * User-visible "No edges found in the selection" has four distinct origins in this file (grep `codemod:`):
 * 1) groupSelectionsByBodyAndAddTags — no body keys (empty selectionsByBody)
 * 2) groupSelectionsByBodyAndAddTags — body keys existed but no fillet rows produced (empty bodies map)
 * 3) buildSolidsAndTagsExprs — no tags expression
 * 4) insertPrimitiveEdgeVariablesAndOffsetPathToNode — tagsExpr empty after edgeId inserts (e.g. blend)
 *
 * Fillet review uses addFillet → (1) or (2) only.
 */

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
  nodeToEdit?: PathToNode,
  options?: { includePrimitiveEdgeIndices?: boolean }
):
  | {
      modifiedAst: Node<Program>
      bodies: Map<string, BodySelectionData>
    }
  | Error {
  const includePrimitiveEdgeIndices =
    options?.includePrimitiveEdgeIndices ?? false
  const selectionsByBody = groupSelectionsByBody(selections, artifactGraph)
  if (err(selectionsByBody)) return selectionsByBody

  const primitiveSelectionsByBody = new Map<
    string,
    {
      bodySelection: ResolvedGraphSelection
      primitiveIndices: number[]
    }
  >()
  if (includePrimitiveEdgeIndices) {
    for (const selection of selections.otherSelections) {
      if (
        !isEnginePrimitiveSelection(selection) ||
        !selection.parentEntityId ||
        selection.primitiveType !== 'edge'
      ) {
        continue
      }

      const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
        selection.parentEntityId,
        artifactGraph
      )
      if (!bodySelection?.artifact || !bodySelection.codeRef) {
        continue
      }
      const resolvedBodySelection: ResolvedGraphSelection = {
        artifact: bodySelection.artifact,
        codeRef: bodySelection.codeRef,
      }

      const bodyKey = JSON.stringify(bodySelection.codeRef.pathToNode)
      const byBody = primitiveSelectionsByBody.get(bodyKey)
      if (byBody) {
        if (!byBody.primitiveIndices.includes(selection.primitiveIndex)) {
          byBody.primitiveIndices.push(selection.primitiveIndex)
        }
      } else {
        primitiveSelectionsByBody.set(bodyKey, {
          bodySelection: resolvedBodySelection,
          primitiveIndices: [selection.primitiveIndex],
        })
      }

      if (!selectionsByBody.has(bodyKey)) {
        selectionsByBody.set(bodyKey, {
          graphSelections: [],
          otherSelections: [],
        })
      }
    }

    // Same SelectionV2 row as graph edge; topology_fallback supplies primitive index for the
    // primitive-edge topology path when tag-based graph resolution is unavailable.
    // Shell inner edges often lack wall/cap in the artifact graph — resolveToCodeRef may fail; use
    // engineTopologyFallback.parentId to find the sweep body and edgeId(solid, primitiveIndex).
    for (const v2Sel of selections.graphSelections) {
      const topo = getEngineTopologyFallbackNormalized(v2Sel)
      if (!topo) continue
      const debugFillet = debugFilletTopologyLogs()
      if (debugFillet) {
        console.info(
          '[groupSelectionsByBodyAndAddTags topology loop] primitive-edge topology candidate',
          {
            parentId: topo.parentId,
            primitiveIndex: topo.primitiveIndex,
            hasGraphEntityRef: Boolean(v2Sel.entityRef),
            hasGraphCodeRefPath: Boolean(v2Sel.codeRef?.pathToNode),
          }
        )
      }
      const { parentId, primitiveIndex } = topo

      let sweepArtifact: SweepArtifact | null = null
      let usedParentIdFallback = false

      const resolved = resolveToCodeRef(v2Sel, artifactGraph)
      if (resolved) {
        const sweepTry = getSweepArtifactFromSelection(resolved, artifactGraph)
        if (!err(sweepTry)) {
          sweepArtifact = sweepTry
        }
      }

      if (!sweepArtifact) {
        const fromParent = getBodySelectionFromPrimitiveParentEntityId(
          parentId,
          artifactGraph
        )
        if (fromParent?.artifact && fromParent.codeRef) {
          if (fromParent.artifact.type === 'sweep') {
            sweepArtifact = fromParent.artifact
          } else if (fromParent.artifact.type === 'compositeSolid') {
            // Shell/boolean body: same codeRef/id wiring as sweep for edgeId(solid, index)
            sweepArtifact = fromParent.artifact as unknown as SweepArtifact
          } else {
            const resolvedParent: ResolvedGraphSelection = {
              artifact: fromParent.artifact,
              codeRef: fromParent.codeRef,
            }
            const sweepTry = getSweepArtifactFromSelection(
              resolvedParent,
              artifactGraph
            )
            if (!err(sweepTry)) {
              sweepArtifact = sweepTry
            }
          }
        }
        if (sweepArtifact) {
          usedParentIdFallback = true
        }
      }

      if (!sweepArtifact) {
        if (debugFilletTopologyLogs()) {
          const fp = getBodySelectionFromPrimitiveParentEntityId(
            parentId,
            artifactGraph
          )
          console.info(
            '[groupSelectionsByBodyAndAddTags topology loop] skip: no sweepArtifact after resolve + parentId',
            {
              parentId,
              primitiveIndex,
              fromParentType: fp?.artifact?.type ?? null,
            }
          )
        }
        continue
      }

      const bodyKey = JSON.stringify(sweepArtifact.codeRef.pathToNode)
      const bodySelection: ResolvedGraphSelection = {
        artifact: sweepArtifact as Artifact,
        codeRef: sweepArtifact.codeRef,
      }
      if (debugFillet) {
        console.info(
          '[groupSelectionsByBodyAndAddTags topology loop] assigning primitive indices to body',
          {
            parentId,
            primitiveIndex,
            bodyKeySnippet: bodyKey.slice(0, 80),
            sweepArtifactType: (sweepArtifact as Artifact).type,
          }
        )
      }
      const byBody = primitiveSelectionsByBody.get(bodyKey)
      if (byBody) {
        if (!byBody.primitiveIndices.includes(primitiveIndex)) {
          byBody.primitiveIndices.push(primitiveIndex)
        }
      } else {
        primitiveSelectionsByBody.set(bodyKey, {
          bodySelection,
          primitiveIndices: [primitiveIndex],
        })
      }
      if (!selectionsByBody.has(bodyKey)) {
        selectionsByBody.set(bodyKey, {
          graphSelections: [],
          otherSelections: [],
        })
      }

      if (usedParentIdFallback) {
        console.warn(
          '[fillet primitive-edge topology path] entity_get_parent_id lookup executed — engine should now provide sweep/composite artifacts',
          {
            bodyKeySnippet: bodyKey.slice(0, 80),
            primitiveIndex,
            parentId,
          }
        )
      } else if (debugFillet) {
        console.info('[fillet primitive-edge topology path]', {
          bodyKeySnippet: bodyKey.slice(0, 80),
          primitiveIndex,
          parentId,
          usedParentIdFallback,
        })
      }
    }
  }

  if (selectionsByBody.size === 0) {
    return new Error(
      'No edges found in the selection (codemod: groupSelectionsByBodyAndAddTags — no body keys; graph grouping + primitive-edge topology path produced nothing)'
    )
  }

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
      const firstResolved = resolveToCodeRef(
        bodySelections.graphSelections[0],
        artifactGraph
      )
      if (firstResolved) {
        const sweep = getSweepArtifactFromSelection(
          firstResolved,
          artifactGraph
        )
        if (!err(sweep)) {
          bodySelectionForSolids = {
            codeRef: sweep.codeRef,
          }
        }
      }
    }
    if (!bodySelectionForSolids) {
      bodySelectionForSolids =
        primitiveSelectionsByBody.get(bodyKey)?.bodySelection
    }

    // Build solids expression: use V2 selection or, when only engine primitive edges, body from primitive
    const firstResolved = bodySelections.graphSelections[0]
      ? resolveToCodeRef(bodySelections.graphSelections[0], artifactGraph)
      : null
    let sweepResult: ReturnType<typeof getSweepArtifactFromSelection>
    if (firstResolved) {
      const trySweep = getSweepArtifactFromSelection(
        firstResolved,
        artifactGraph
      )
      if (!err(trySweep)) {
        sweepResult = trySweep
      } else {
        const primitiveBody =
          primitiveSelectionsByBody.get(bodyKey)?.bodySelection
        if (primitiveBody?.artifact) {
          if (primitiveBody.artifact.type === 'sweep') {
            sweepResult = primitiveBody.artifact
          } else if (primitiveBody.artifact.type === 'compositeSolid') {
            sweepResult = primitiveBody.artifact as unknown as SweepArtifact
          } else {
            sweepResult = getSweepArtifactFromSelection(
              primitiveBody,
              artifactGraph
            )
          }
        } else {
          sweepResult = trySweep
        }
      }
    } else {
      const primitiveBody =
        primitiveSelectionsByBody.get(bodyKey)?.bodySelection
      if (!primitiveBody?.artifact) continue
      if (primitiveBody.artifact.type === 'sweep') {
        sweepResult = primitiveBody.artifact
      } else if (primitiveBody.artifact.type === 'compositeSolid') {
        sweepResult = primitiveBody.artifact as unknown as SweepArtifact
      } else {
        sweepResult = getSweepArtifactFromSelection(
          primitiveBody,
          artifactGraph
        )
      }
    }
    if (err(sweepResult)) continue
    const sweep = sweepResult
    const solids: Selections = {
      graphSelections: [
        {
          entityRef: artifactToEntityRef('sweep', sweep.id),
          codeRef: sweep.codeRef,
        },
      ],
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
      }
    )
    if (err(vars)) return vars

    const solidsExpr = createVariableExpressionsArray(vars.exprs)

    const tagsExprsCombined = [...tagsExprs]
    const primForBody = primitiveSelectionsByBody.get(bodyKey)
    if (primForBody?.primitiveIndices.length && solidsExpr) {
      let insertIndex = modifiedAst.body.length
      for (const primitiveIndex of primForBody.primitiveIndices) {
        const edgeIdExpr = createCallExpressionStdLibKw(
          'edgeId',
          structuredClone(solidsExpr),
          [
            createLabeledArg(
              'index',
              createLiteral(primitiveIndex, wasmInstance)
            ),
          ]
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
        tagsExprsCombined.push(variableIdentifierAst)
      }
    }

    if (tagsExprsCombined.length === 0) {
      continue
    }

    const tagsExpr = createVariableExpressionsArray(tagsExprsCombined)
    if (!tagsExpr) {
      continue
    }

    bodies.set(bodyKey, {
      solidsExpr,
      tagsExpr,
      pathIfPipe: vars.pathIfPipe,
    })
  }

  if (bodies.size === 0) {
    return new Error(
      'No edges found in the selection (codemod: groupSelectionsByBodyAndAddTags — had body keys but every body skipped: no tags + no edgeId rows)'
    )
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
  const bodyToV2Selections = new Map<string, Selection[]>()

  for (const v2Sel of selections.graphSelections) {
    const resolved = resolveToCodeRef(v2Sel, artifactGraph)
    const topologyNormalized = getEngineTopologyFallbackNormalized(v2Sel)
    const debugFillet = debugFilletTopologyLogs()
    const rawTopologyCamel = v2Sel.engineTopologyFallback ?? undefined
    const rawTopologySnake = (v2Sel as { engine_topology_fallback?: unknown })
      .engine_topology_fallback
    if (!resolved) {
      if (debugFillet) {
        console.info('[groupSelectionsByBody] v2 iteration', {
          resolved: false,
          engineTopologyFallbackCamel: rawTopologyCamel ?? null,
          engineTopologyFallbackSnake: rawTopologySnake ?? null,
          topologyNormalized,
        })
      }
      continue
    }
    const sweepArtifact = getSweepArtifactFromSelection(resolved, artifactGraph)
    if (debugFillet) {
      console.info('[groupSelectionsByBody] v2 iteration', {
        resolved: true,
        resolvedArtifactType: resolved.artifact?.type,
        sweepFailed: err(sweepArtifact),
        engineTopologyFallbackCamel: rawTopologyCamel ?? null,
        engineTopologyFallbackSnake: rawTopologySnake ?? null,
        topologyNormalized,
      })
    }
    if (err(sweepArtifact)) {
      // Shell inner edges: graph may not resolve to a sweep; use the primitive-edge topology path
      // and edgeId(index) below. Use normalized topology data so snake_case engine_topology_fallback
      // is honored the same way as the topology grouping loop.
      if (topologyNormalized) {
        if (debugFillet) {
          console.info(
            '[groupSelectionsByBody] sweep lookup failed; deferring to primitive-edge topology path',
            {
              topologyNormalized,
              codeRefPath: resolved.codeRef.pathToNode,
            }
          )
        }
        continue
      }
      return sweepArtifact
    }

    const bodyKey = JSON.stringify(sweepArtifact.codeRef.pathToNode)
    if (bodyToV2Selections.has(bodyKey)) {
      bodyToV2Selections.get(bodyKey)!.push(v2Sel)
    } else {
      bodyToV2Selections.set(bodyKey, [v2Sel])
    }
  }

  const result = new Map<string, Selections>()
  for (const [bodyKey, v2Sels] of bodyToV2Selections.entries()) {
    result.set(bodyKey, {
      graphSelections: v2Sels,
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
    graphSelections: faces.graphSelections.flatMap((f: Selection) => {
      const resolved = resolveToCodeRef(f, artifactGraph)
      if (!resolved?.artifact) return []
      const sweep = getSweepArtifactFromSelection(resolved, artifactGraph)
      if (err(sweep) || !sweep) return []
      return [
        {
          entityRef: artifactToEntityRef('sweep', sweep.id),
          codeRef: sweep.codeRef,
        },
      ]
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
    return new Error(
      'No edges found in the selection (codemod: buildSolidsAndTagsExprs — no tags expression after getTagsExprsFromSelection)'
    )
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
  for (const v2Sel of edges.graphSelections) {
    const resolved = resolveToCodeRef(v2Sel, artifactGraph)
    if (!resolved) continue
    const result = modifyAstWithTagsForSelection(
      modifiedAst,
      resolved,
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
  _unlabeledArg: unknown,
  tagsArg: OpArg,
  artifactGraph: ArtifactGraph,
  _code?: string
) {
  if (
    !tagsArg?.value ||
    typeof tagsArg.value !== 'object' ||
    !('type' in tagsArg.value)
  ) {
    return { graphSelections: [], otherSelections: [] }
  }
  const tagValues: OpKclValue[] = []
  if (tagsArg.value.type === 'Array') {
    tagValues.push(...tagsArg.value.value)
  } else {
    tagValues.push(tagsArg.value)
  }

  const graphSelections: Selection[] = []
  for (const v of tagValues) {
    if (v == null || typeof v !== 'object' || !('type' in v)) {
      console.warn(
        'retrieveEdgeSelectionsFromOpArgs: skipping invalid tag value',
        v
      )
      continue
    }
    const key =
      v.type === 'Uuid' && v.value
        ? v.value
        : v.type === 'TagIdentifier' &&
            (v as { artifact_id?: string }).artifact_id
          ? (v as { artifact_id: string }).artifact_id
          : null
    if (!key) {
      console.warn('Tag value is not Uuid or TagIdentifier with artifact_id', v)
      continue
    }

    const artifact = getArtifactOfTypes(
      { key, types: ['segment', 'edgeCut'] },
      artifactGraph
    )
    if (err(artifact)) {
      console.warn('No artifact found for tag', key)
      continue
    }

    const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      console.warn('No codeRefs found for artifact', artifact)
      continue
    }

    const pathId =
      artifact.type === 'segment'
        ? (artifact as { pathId?: string }).pathId
        : undefined
    const entityRef = artifactToEntityRef(artifact.type, artifact.id, pathId)
    if (!entityRef) continue
    graphSelections.push({ entityRef, codeRef: codeRefs[0] })
  }

  return { graphSelections, otherSelections: [] }
}

function faceRefToArtifactId(v: OpKclValue): string | null {
  if (v.type === 'Uuid' && v.value) return v.value
  if (
    v.type === 'TagIdentifier' &&
    (v as { artifact_id?: string }).artifact_id
  ) {
    return (v as { artifact_id: string }).artifact_id
  }
  return null
}

/**
 * Finds an edge artifact (segment or edgeCut) given the set of face
 * artifact IDs from an edgeRef. For getCommonEdge(faces=[seg01, capStart001]),
 * one "face" may be the segment (the edge) and one the cap; or both may be
 * wall/cap and we find the segment whose derived common faces match.
 */
function findEdgeArtifactFromFaceIds(
  faceIds: string[],
  artifactGraph: ArtifactGraph
): Artifact | null {
  if (faceIds.length === 0) return null
  const faceArtifacts: Artifact[] = []
  for (const id of faceIds) {
    const a = artifactGraph.get(id)
    if (a) faceArtifacts.push(a)
  }
  if (faceArtifacts.length === 0) return null
  const edgeType = (
    a: Artifact
  ): a is Artifact & { type: 'segment' | 'edgeCut' } =>
    a.type === 'segment' || a.type === 'edgeCut'
  const asEdge = faceArtifacts.find(edgeType)
  if (asEdge) return asEdge
  const faceIdSet = new Set(faceIds)
  for (const [, artifact] of artifactGraph) {
    if (artifact.type !== 'segment') continue
    const commonFaces = getCommonFacesForEdge(artifact, artifactGraph)
    if (err(commonFaces)) continue
    const commonSet = new Set(commonFaces.map((face) => face.id))
    if (
      faceIdSet.size === commonSet.size &&
      [...faceIdSet].every((id) => commonSet.has(id))
    ) {
      return artifact
    }
  }
  return null
}

/**
 * Retrieves edge selections from edgeRefs argument (new API).
 * Used for edit flows when reading existing fillet calls with edgeRefs.
 * Parses edgeRefs array of objects with "sideFaces" array (UUID or TagIdentifier refs)
 * and resolves each to graphSelections for the command bar edit flow.
 */
export function retrieveEdgeSelectionsFromEdgeRefs(
  edgeRefsArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (edgeRefsArg.value.type !== 'Array') {
    return new Error('edgeRefs argument is not an array')
  }
  const edgeRefItems = edgeRefsArg.value.value
  const graphSelections: Selection[] = []

  for (const item of edgeRefItems) {
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
    const entityRef: EntityReference = { type: 'edge', side_faces: faceIds }
    graphSelections.push({ entityRef, codeRef: codeRefs[0] })
  }

  return { graphSelections, otherSelections: [] }
}

/**
 * Retrieves edge selections from a single edge-ref-shaped kw arg (legacy `edgeRef` or `axis` object).
 * Used for edit flows when the call has axis = { sideFaces = [...] } (or legacy edgeRef = ...).
 */
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
  const faceValues = facesProp.value ?? []
  const faceIds: string[] = []
  for (const v of faceValues) {
    const id = faceRefToArtifactId(v)
    if (id) faceIds.push(id)
  }
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
  const entityRef: EntityReference = { type: 'edge', side_faces: faceIds }
  return {
    graphSelections: [{ entityRef, codeRef: codeRefs[0] }],
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
  selection: ResolvedGraphSelection,
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
  const { artifact, codeRef } = selection
  if (!artifact || artifact.type !== 'edgeCut') {
    return new Error('Selection is not an edge cut')
  }
  if (!codeRef) {
    return new Error('Selection has no codeRef')
  }

  const { subType } = artifact
  if (!isEdgeTreatmentType(subType)) {
    return new Error('Unsupported or missing edge treatment type')
  }

  // 2. Clone ast and retrieve the edge treatment node
  const astClone = structuredClone(ast)
  const edgeTreatmentNode = getNodeFromPath<
    VariableDeclarator | ExpressionStatement
  >(astClone, codeRef.pathToNode, wasmInstance, [
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
    const deleteResult = deleteTopLevelStatement(astClone, codeRef.pathToNode)
    if (err(deleteResult)) return deleteResult
    return astClone
  } else {
    const deleteResult = deleteNodeInExtrudePipe(
      astClone,
      codeRef.pathToNode,
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

  // selectionsV2: edge artifacts are segment or edgeCut (sweepEdge removed); use tag directly
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
      bodySelection: ResolvedGraphSelection
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
    if (!bodySelection?.artifact || !bodySelection.codeRef) {
      continue
    }
    const resolvedBodySelection: ResolvedGraphSelection = {
      artifact: bodySelection.artifact,
      codeRef: bodySelection.codeRef,
    }

    const bodyKey = JSON.stringify(bodySelection.codeRef.pathToNode)
    const byBody = primitiveSelectionsByBody.get(bodyKey)
    if (byBody) {
      if (!byBody.primitiveIndices.includes(selection.primitiveIndex)) {
        byBody.primitiveIndices.push(selection.primitiveIndex)
      }
    } else {
      primitiveSelectionsByBody.set(bodyKey, {
        bodySelection: resolvedBodySelection,
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
      const art = primitiveData.bodySelection.artifact
      const pathId =
        art?.type === 'segment'
          ? (art as { pathId?: string }).pathId
          : undefined
      const entityRef = artifactToEntityRef(
        art?.type ?? 'sweep',
        art?.id ?? '',
        pathId
      )
      if (!entityRef) continue
      const vars = getVariableExprsFromSelection(
        {
          graphSelections: [
            { entityRef, codeRef: primitiveData.bodySelection.codeRef },
          ],
          otherSelections: [],
        },
        artifactGraph,
        modifiedAst,
        wasmInstance,
        nodeToEdit,
        {
          lastChildLookup: true,
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
      return new Error(
        'No edges found in the selection (codemod: insertPrimitiveEdgeVariablesAndOffsetPathToNode — tagsExpr empty after edgeId inserts)'
      )
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
