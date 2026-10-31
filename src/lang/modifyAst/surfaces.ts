import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
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
} from '@src/lang/modifyAst/edges'
import {
  getVariableExprsFromSelection,
  stringifyPathToNode,
  resolveToCodeRef,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getSafeInsertIndex } from '@src/lang/queryAst/getSafeInsertIndex'
import { getMergedSweepBodyArtifact } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph, Expr, PathToNode, Program } from '@src/lang/wasm'
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
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'

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
  const { graphSelections, otherSelections } = curves
  const selectionCount = graphSelections.length + otherSelections.length
  if (selectionCount === 0) {
    return new Error('Select one sketch region or swept-body edges.')
  }

  let modifiedAst = structuredClone(ast)
  let pathIfPipe: PathToNode | undefined
  let curvesExpr: Expr
  if (otherSelections.length > 0) {
    const [region] = otherSelections
    if (selectionCount !== 1 || !isEngineRegionSelection(region)) {
      return new Error(
        'Select one sketch region or a list of swept-body edges.'
      )
    }
    const engineRegions = [region]
    const hidden = addHideCallsForRegionSketches({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (isErr(hidden)) return hidden
    modifiedAst = hidden
    const regions = insertRegionVariablesAndOffsetPathToNode({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (isErr(regions)) return regions
    curvesExpr = regions[0]
  } else if (graphSelections[0].entityRef?.type === 'edge') {
    const edges: Expr[] = []
    for (const selection of graphSelections) {
      const edge = getPlanarBodyEdgeExpression({
        selection,
        modifiedAst,
        artifactGraph,
        wasmInstance,
      })
      if (isErr(edge)) return edge
      if (edge.pathIfPipe) {
        if (
          pathIfPipe &&
          stringifyPathToNode(pathIfPipe) !==
            stringifyPathToNode(edge.pathIfPipe) &&
          !pathsReferToSamePipe(pathIfPipe, edge.pathIfPipe)
        ) {
          return new Error(
            'Assign variables to the selected bodies before combining their edges.'
          )
        }
        pathIfPipe = edge.pathIfPipe
      }
      modifiedAst = edge.modifiedAst
      edges.push(edge.expr)
    }
    curvesExpr = createArrayExpression(edges)
  } else {
    const artifact = resolveToCodeRef(
      graphSelections[0],
      artifactGraph
    )?.artifact
    const path =
      artifact?.type === 'solid2d'
        ? artifactGraph.get(artifact.pathId)
        : artifact
    if (
      selectionCount !== 1 ||
      path?.type !== 'path' ||
      path.subType !== 'region'
    ) {
      return new Error(
        'Select a sketch region or a Face API edge from the viewport.'
      )
    }
    const region = getVariableExprsFromSelection(
      curves,
      artifactGraph,
      modifiedAst,
      wasmInstance
    )
    if (isErr(region)) return region
    if (region.exprs.length !== 1) {
      return new Error('Could not resolve the selected region in code.')
    }
    curvesExpr = region.exprs[0]
    pathIfPipe = region.pathIfPipe
  }

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

function getPlanarBodyEdgeExpression({
  selection,
  modifiedAst,
  artifactGraph,
  wasmInstance,
}: {
  selection: Selection
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
}):
  | Error
  | { modifiedAst: Node<Program>; expr: Expr; pathIfPipe?: PathToNode } {
  const reference = selection.entityRef
  if (reference?.type !== 'edge' || reference.side_faces.length === 0)
    return new Error(
      'Select an edge with Face API references from the viewport.'
    )
  const topology = getEngineTopologyFallbackNormalized(selection)
  let bodySelection =
    (topology &&
      getBodySelectionFromPrimitiveParentEntityId(
        topology.parentId,
        artifactGraph
      )) ??
    getBodySelectionFromPrimitiveParentEntityId(
      reference.side_faces[0],
      artifactGraph
    )
  if (!bodySelection?.artifact || !bodySelection.codeRef)
    return new Error('Could not resolve the selected edge body in code.')
  if (bodySelection.artifact?.type === 'sweep') {
    const canonicalBody = getMergedSweepBodyArtifact(
      bodySelection.artifact,
      artifactGraph,
      false
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
      lastChildLookup: false,
      artifactTypeFilter: ['compositeSolid', 'sweep'],
    }
  )
  if (isErr(body)) return body
  if (body.exprs.length !== 1)
    return new Error('Could not resolve the selected edge body in code.')
  const bodyExpr = body.exprs[0]

  const tagged = createEdgeRefObjectExpression(
    entityReferenceToEdgeRefPayload(reference),
    wasmInstance,
    modifiedAst,
    artifactGraph,
    resolveToCodeRef(selection, artifactGraph) ?? undefined,
    undefined,
    createMemberExpression(structuredClone(bodyExpr), 'sketch'),
    bodyExpr,
    { requireEveryFace: true, allowTagging: true }
  )
  if (isErr(tagged)) return tagged
  return {
    modifiedAst: tagged.modifiedAst,
    expr: tagged.expr,
    pathIfPipe: body.pathIfPipe,
  }
}
