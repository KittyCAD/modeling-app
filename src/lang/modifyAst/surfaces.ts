import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createMemberExpression,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  insertRegionVariablesAndOffsetPathToNode,
  insertVariableAndOffsetPathToNode,
  pathsReferToSamePipe,
  setCallInAst,
} from '@src/lang/modifyAst'
import { addHideCallsForRegionSketches } from '@src/lang/modifyAst/sweeps'
import {
  createEdgeRefObjectExpression,
  entityReferenceToEdgeRefPayload,
  getPrimitiveEdgeSelections,
} from '@src/lang/modifyAst/edges'
import {
  createSketchTagMemberExpression,
  modifyAstWithTagsForSelection,
  resolveEdgeSelectionContext,
} from '@src/lang/modifyAst/tagManagement'
import {
  getSketchSegmentNameFromSourceSurface,
  getSketchSegmentName,
  getSketchVariableNameForSegment,
  getNodeFromPath,
  getVariableNameFromNodePath,
  getVariableExprsFromSelection,
  stringifyPathToNode,
  resolveToCodeRef,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getSafeInsertIndex } from '@src/lang/queryAst/getSafeInsertIndex'
import {
  getSweepArtifactFromSelection,
  getFaceCodeRef,
  getCodeRefsByArtifactId,
  getMergedSweepBodyArtifact,
  getOriginalSegmentArtifact,
  type ResolvedGraphSelection,
} from '@src/lang/std/artifactGraph'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { modelingStdLibCommandName } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import {
  getBodySelectionFromPrimitiveParentEntityId,
  getEngineTopologyFallbackNormalized,
  isEngineRegionSelection,
} from '@src/lib/selections'
import { err, isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EnginePrimitiveSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'

/**
 * Adds a flipSurface call to the AST.
 *
 * @param ast - The AST to modify
 * @param artifactGraph - The artifact graph for face lookups
 * @param surface - Selected surface to flip
 * @param nodeToEdit - Path to node to edit (for edit mode)
 * @returns Modified AST and path to the last created node, or an Error
 */
export function addFlipSurface({
  ast,
  artifactGraph,
  surface,
  wasmInstance,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  surface: Selections
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled arguments
  if (!mNodeToEdit && surface.graphSelections.length < 1) {
    return new Error('flipSurface surfaces must have at least one selection.')
  }

  let vars: { exprs: Expr[]; pathIfPipe?: PathToNode } = { exprs: [] }
  if (!mNodeToEdit) {
    const selectionVars = getVariableExprsFromSelection(
      surface,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      { lastChildLookup: true }
    )
    if (err(selectionVars)) {
      return selectionVars
    }
    vars = selectionVars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Flip Surface'),
    objectsExpr,
    []
  )

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SURFACE,
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

/**
 * Adds a join call to the AST.
 *
 * @param ast - The AST to modify
 * @param artifactGraph - The artifact graph for body lookups
 * @param selection - Selected bodies to join
 * @param nodeToEdit - Path to node to edit (for edit mode)
 * @returns Modified AST and path to the last created node, or an Error
 */
export function addJoinSurfaces({
  ast,
  artifactGraph,
  selection,
  tolerance,
  wasmInstance,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  selection: Selections
  tolerance?: KclCommandValue
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled arguments
  if (!mNodeToEdit && selection.graphSelections.length < 1) {
    return new Error('join selection must have at least one selection.')
  }

  let vars: { exprs: Expr[]; pathIfPipe?: PathToNode } = { exprs: [] }
  if (!mNodeToEdit) {
    const selectionVars = getVariableExprsFromSelection(
      selection,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      {
        lastChildLookup: true,
        artifactTypeFilter: ['compositeSolid', 'sweep'],
      }
    )
    if (err(selectionVars)) {
      return selectionVars
    }
    vars = selectionVars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Join Surfaces'),
    objectsExpr,
    tolerance ? [createLabeledArg('tolerance', valueOrVariable(tolerance))] : []
  )
  if (tolerance && 'variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SURFACE,
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

export function addPlanarSurface({
  ast,
  artifactGraph,
  curves,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  curves: Selections
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)
  let pathIfPipe: PathToNode | undefined
  const recordCurvePipe = (curvePath?: PathToNode): Error | undefined => {
    if (!curvePath) return
    if (
      pathIfPipe &&
      stringifyPathToNode(pathIfPipe) !== stringifyPathToNode(curvePath) &&
      !pathsReferToSamePipe(pathIfPipe, curvePath)
    ) {
      return new Error(
        'Assign variables to the selected bodies before combining their edges.'
      )
    }
    pathIfPipe = structuredClone(curvePath)
  }

  const engineRegions = curves.otherSelections.filter(isEngineRegionSelection)
  const primitiveEdges = getPrimitiveEdgeSelections(curves)
  const selectionCount =
    curves.graphSelections.length + curves.otherSelections.length
  if (selectionCount === 0) {
    return new Error('Select one sketch region, sketch curves, or body edges.')
  }
  if (
    engineRegions.length + primitiveEdges.length !==
    curves.otherSelections.length
  ) {
    return new Error('Planar Surface requires a region or edges.')
  }

  const exprs: Expr[] = []
  let isRegion = engineRegions.length > 0
  // Resolve references here; KCL and the engine validate the boundary geometry.
  for (const originalSelection of [
    ...curves.graphSelections,
    ...primitiveEdges,
  ]) {
    if (
      'type' in originalSelection ||
      originalSelection.entityRef?.type === 'edge'
    ) {
      const edgeResult = getPlanarBodyEdgeExpression({
        selection: originalSelection,
        modifiedAst,
        artifactGraph,
        wasmInstance,
      })
      if (isErr(edgeResult)) return edgeResult
      modifiedAst = edgeResult.modifiedAst
      const pipeResult = recordCurvePipe(edgeResult.pathIfPipe)
      if (isErr(pipeResult)) return pipeResult
      exprs.push(edgeResult.expr)
      continue
    }
    const resolved = resolveToCodeRef(originalSelection, artifactGraph)
    if (!resolved)
      return new Error('Could not resolve the selected curve in code.')
    let selection: ResolvedGraphSelection = {
      ...originalSelection,
      ...resolved,
    }
    if (selection.artifact?.type === 'solid2d') {
      const path = artifactGraph.get(selection.artifact.pathId)
      if (path?.type !== 'path') {
        return new Error('Could not resolve the selected region in code.')
      }
      selection = { ...selection, artifact: path, codeRef: path.codeRef }
    }
    const artifact = selection.artifact
    if (
      artifact?.type !== 'path' &&
      artifact?.type !== 'segment' &&
      artifact?.type !== 'primitiveEdge'
    ) {
      return new Error('Planar Surface requires a region or edges.')
    }

    if (artifact.type === 'primitiveEdge') {
      const edgeCall = getNodeFromPath<Node<CallExpressionKw>>(
        modifiedAst,
        selection.codeRef.pathToNode,
        wasmInstance,
        'CallExpressionKw'
      )
      if (
        isErr(edgeCall) ||
        edgeCall.node.type !== 'CallExpressionKw' ||
        edgeCall.node.callee.name.name !== 'edgeId'
      ) {
        return new Error(
          'Could not resolve the selected edge reference in code.'
        )
      }
      const variableName = getVariableNameFromNodePath(
        selection.codeRef.pathToNode,
        modifiedAst,
        wasmInstance
      )
      exprs.push(
        variableName
          ? createLocalName(variableName)
          : structuredClone(edgeCall.node)
      )
      continue
    }

    const segmentPath =
      artifact.type === 'segment'
        ? artifactGraph.get(artifact.pathId)
        : undefined
    const isSolvedSegment =
      artifact.type === 'segment' &&
      !artifact.sourceSegmentId &&
      !(segmentPath?.type === 'path' && segmentPath.sweepId) &&
      getSketchVariableNameForSegment(
        modifiedAst,
        artifact.id,
        artifactGraph,
        wasmInstance
      ) !== null
    const isSurfaceEdge =
      artifact.type === 'segment' &&
      !isSolvedSegment &&
      !isErr(getSweepArtifactFromSelection(selection, artifactGraph))

    if (isSurfaceEdge) {
      const result = getPlanarSegmentEdgeExpression({
        selection,
        modifiedAst,
        artifactGraph,
        wasmInstance,
      })
      if (isErr(result)) return result
      modifiedAst = result.modifiedAst
      const pipeResult = recordCurvePipe(result.pathIfPipe)
      if (isErr(pipeResult)) return pipeResult
      exprs.push(result.expr)
    } else {
      isRegion ||=
        artifact.type === 'path' ||
        (artifact.type === 'segment' && !isSolvedSegment)
      const result = getVariableExprsFromSelection(
        { graphSelections: [selection], otherSelections: [] },
        artifactGraph,
        modifiedAst,
        wasmInstance
      )
      if (isErr(result)) return result
      if (result.exprs.length !== 1) {
        return new Error('Could not resolve the selected curve in code.')
      }
      pathIfPipe = structuredClone(result.pathIfPipe) ?? pathIfPipe
      exprs.push(...result.exprs)
    }
  }

  if (isRegion && selectionCount !== 1) {
    return new Error('Select one sketch region, or a list of curves or edges.')
  }

  if (engineRegions.length > 0) {
    const hideResult = addHideCallsForRegionSketches({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (isErr(hideResult)) return hideResult
    modifiedAst = hideResult
    const regionResult = insertRegionVariablesAndOffsetPathToNode({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (isErr(regionResult)) return regionResult
    exprs.push(...regionResult)
  }

  // The stdlib takes one Sketch directly, but requires arrays for curves,
  // including a single closed curve such as a circle.
  const curvesExpr = isRegion
    ? createVariableExpressionsArray(exprs)
    : createArrayExpression(exprs)

  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Planar Surface'),
    curvesExpr,
    []
  )
  const pipeIndex = pathIfPipe?.[1]?.[0]
  if (
    typeof pipeIndex === 'number' &&
    getSafeInsertIndex(call, modifiedAst) > pipeIndex + 1
  ) {
    return new Error(
      'Assign a variable to the anonymous body before using values defined later in the file.'
    )
  }
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathIfNewPipe: pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SURFACE,
    wasmInstance,
  })
  if (isErr(pathToNode)) return pathToNode
  return { modifiedAst, pathToNode }
}

// Planar Surface still accepts individual Edge values. Keep their references
// executable on each run while adapting the Face API selection representation.
function getPlanarBodyEdgeExpression({
  selection,
  modifiedAst,
  artifactGraph,
  wasmInstance,
}: {
  selection: Selection | EnginePrimitiveSelection
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
}):
  | Error
  | { modifiedAst: Node<Program>; expr: Expr; pathIfPipe?: PathToNode } {
  const isPrimitive = 'type' in selection
  const reference = isPrimitive ? null : selection.entityRef
  if (!isPrimitive && reference?.type !== 'edge')
    return new Error('Select an edge.')
  const topology = isPrimitive
    ? selection.parentEntityId
      ? {
          parentId: selection.parentEntityId,
          primitiveIndex: selection.primitiveIndex,
        }
      : null
    : getEngineTopologyFallbackNormalized(selection)
  let bodySelection = topology
    ? getBodySelectionFromPrimitiveParentEntityId(
        topology.parentId,
        artifactGraph
      )
    : null
  if (!bodySelection && reference?.type === 'edge') {
    for (const faceId of reference.side_faces) {
      const artifact = artifactGraph.get(faceId)
      if (!artifact) continue
      const codeRef =
        getFaceCodeRef(artifact) ??
        getCodeRefsByArtifactId(faceId, artifactGraph)?.[0]
      if (!codeRef) continue
      const sweep = getSweepArtifactFromSelection(
        { artifact, codeRef },
        artifactGraph
      )
      if (isErr(sweep)) continue
      bodySelection = { artifact: sweep, codeRef: sweep.codeRef }
      break
    }
  }
  if (!bodySelection?.artifact || !bodySelection.codeRef)
    return new Error('Could not resolve the selected edge body in code.')
  if (bodySelection.artifact?.type === 'sweep') {
    // Raw primitive selections follow merged bodies; graph selections keep their sweep.
    const canonicalBody = getMergedSweepBodyArtifact(
      bodySelection.artifact,
      artifactGraph,
      isPrimitive
    )
    if (isErr(canonicalBody)) return canonicalBody
    bodySelection = { artifact: canonicalBody, codeRef: canonicalBody.codeRef }
  }
  const body = getVariableExprsFromSelection(
    { graphSelections: [bodySelection], otherSelections: [] },
    artifactGraph,
    modifiedAst,
    wasmInstance,
    undefined,
    {
      lastChildLookup: isPrimitive && bodySelection.artifact?.type !== 'sweep',
      artifactTypeFilter: ['compositeSolid', 'sweep'],
    }
  )
  if (isErr(body)) return body
  if (body.exprs.length !== 1)
    return new Error('Could not resolve the selected edge body in code.')
  const bodyExpr = body.exprs[0]

  const hasSemanticEdge =
    reference?.type === 'edge' &&
    bodySelection.artifact?.type !== 'compositeSolid' &&
    reference.side_faces.length === 2 &&
    reference.side_faces.every((id) => artifactGraph.has(id)) &&
    !reference.end_faces?.length &&
    reference.index == null
  const topologyResult = topology
    ? {
        modifiedAst,
        expr: createCallExpressionStdLibKw('edgeId', bodyExpr, [
          createLabeledArg(
            'index',
            createLiteral(topology.primitiveIndex, wasmInstance)
          ),
        ]),
        pathIfPipe: body.pathIfPipe,
      }
    : null
  // getCommonEdge identifies one edge from two semantic face tags. An index
  // within an EdgeReference is not the body's topology index; never substitute it.
  if (isPrimitive || !hasSemanticEdge) {
    return (
      topologyResult ??
      new Error(
        'Could not resolve the selected boundary edge. Select it in the viewport again.'
      )
    )
  }
  const tagged = createEdgeRefObjectExpression(
    entityReferenceToEdgeRefPayload(reference),
    wasmInstance,
    structuredClone(modifiedAst),
    artifactGraph,
    resolveToCodeRef(selection, artifactGraph) ?? undefined,
    undefined,
    createMemberExpression(structuredClone(bodyExpr), 'sketch'),
    bodyExpr
  )
  if (isErr(tagged)) return topologyResult ?? tagged
  const sideFaces =
    tagged.expr.type === 'ObjectExpression'
      ? tagged.expr.properties.find(
          (property) => property.key.name === 'sideFaces'
        )?.value
      : undefined
  if (!sideFaces)
    return new Error('Could not resolve the selected edge faces in code.')
  return {
    modifiedAst: tagged.modifiedAst,
    expr: createCallExpressionStdLibKw('getCommonEdge', null, [
      createLabeledArg('faces', sideFaces),
    ]),
    pathIfPipe: body.pathIfPipe,
  }
}

function getPlanarSegmentEdgeExpression({
  selection,
  modifiedAst,
  artifactGraph,
  wasmInstance,
}: {
  selection: ResolvedGraphSelection
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
}):
  | Error
  | { modifiedAst: Node<Program>; expr: Expr; pathIfPipe?: PathToNode } {
  if (selection.artifact?.type !== 'segment')
    return new Error('Select an edge.')
  const context = resolveEdgeSelectionContext(
    modifiedAst,
    selection,
    artifactGraph,
    wasmInstance,
    undefined,
    false
  )
  if (isErr(context)) return context
  let tag = getSketchSegmentNameFromSourceSurface(
    context.sourceSweep,
    selection.artifact,
    artifactGraph,
    modifiedAst,
    wasmInstance
  )
  if (!tag) {
    const original = getOriginalSegmentArtifact(
      selection.artifact.id,
      artifactGraph
    )
    const segmentId = original?.id ?? selection.artifact.id
    if (
      getSketchVariableNameForSegment(
        modifiedAst,
        segmentId,
        artifactGraph,
        wasmInstance
      )
    ) {
      tag = getSketchSegmentName(
        modifiedAst,
        segmentId,
        artifactGraph,
        wasmInstance
      )
    }
  }
  if (!tag) {
    const result = modifyAstWithTagsForSelection(
      modifiedAst,
      selection,
      artifactGraph,
      wasmInstance,
      ['oppositeAndAdjacentEdges']
    )
    if (isErr(result)) return result
    modifiedAst = result.modifiedAst
    const tagExpr = result.exprs[0]
    if (tagExpr?.type !== 'Name')
      return new Error('Could not resolve the selected edge tag.')
    tag = tagExpr.name.name
  }
  return {
    modifiedAst,
    expr: createSketchTagMemberExpression(context.selectedBodyExpr, tag),
    pathIfPipe: context.pathIfPipe,
  }
}
