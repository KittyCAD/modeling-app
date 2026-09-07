import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  insertRegionVariablesAndOffsetPathToNode,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  addHideCallsForRegionSketches,
  getEdgeProfileExprsFromSelection,
} from '@src/lang/modifyAst/sweeps'
import {
  getSketchVariableNameForSegment,
  getNodeFromPath,
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getSweepArtifactFromSelection } from '@src/lang/std/artifactGraph'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import { modelingStdLibCommandName } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import {
  isEnginePrimitiveSelection,
  isEngineRegionSelection,
} from '@src/lib/selections'
import { err, isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

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
  tolerance,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  curves: Selections
  tolerance?: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  let curvesExpr: Expr | null = null
  let pathIfPipe: PathToNode | undefined

  // Curves are hidden in the edit command. Keep the original expression,
  // including its loop order and any inline region or edge calls.
  if (!mNodeToEdit) {
    const engineRegions = curves.otherSelections.filter(isEngineRegionSelection)
    const selectionCount =
      curves.graphSelections.length + curves.otherSelections.length
    if (selectionCount === 0) {
      return new Error('Select a closed region or a closed loop of edges.')
    }
    if (
      curves.otherSelections.some(
        (selection) =>
          !isEngineRegionSelection(selection) &&
          !(
            isEnginePrimitiveSelection(selection) &&
            selection.primitiveType === 'edge'
          )
      )
    ) {
      return new Error('Planar Surface requires a region or edges.')
    }

    const exprs: Expr[] = []
    let sketchCount = engineRegions.length
    let solvedSegmentCount = 0
    const primitiveEdges = curves.otherSelections.filter(
      (selection) =>
        isEnginePrimitiveSelection(selection) &&
        selection.primitiveType === 'edge'
    )
    if (primitiveEdges.length > 0 && curves.graphSelections.length > 0) {
      // Selections store graph and engine primitives separately, so the
      // original loop order cannot be recovered across these collections.
      return new Error(
        'This combination of edges is not supported. Select a sketch region instead.'
      )
    }
    for (const originalSelection of curves.graphSelections) {
      let selection = originalSelection
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
        artifact?.type !== 'sweepEdge' &&
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
        const variable = getNodeFromPath<VariableDeclaration>(
          modifiedAst,
          selection.codeRef.pathToNode,
          wasmInstance,
          'VariableDeclaration'
        )
        const init =
          isErr(variable) || variable.node.type !== 'VariableDeclaration'
            ? null
            : variable.node.declaration.init
        exprs.push(
          init?.type === 'CallExpressionKw' &&
            init.start === edgeCall.node.start &&
            !isErr(variable) &&
            variable.node.type === 'VariableDeclaration'
            ? createLocalName(variable.node.declaration.id.name)
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
        artifact.type === 'sweepEdge' ||
        (artifact.type === 'segment' &&
          !isSolvedSegment &&
          !isErr(getSweepArtifactFromSelection(selection, artifactGraph)))

      if (isSurfaceEdge) {
        const result = getEdgeProfileExprsFromSelection({
          selections: { graphSelections: [selection], otherSelections: [] },
          modifiedAst,
          artifactGraph,
          wasmInstance,
          includeSegments: true,
        })
        if (isErr(result)) return result
        modifiedAst = result.modifiedAst
        exprs.push(...result.exprs)
      } else {
        if (isSolvedSegment) solvedSegmentCount++
        if (
          artifact.type === 'path' ||
          (artifact.type === 'segment' && !isSolvedSegment)
        )
          sketchCount++
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

    if (sketchCount > 0 && (sketchCount !== 1 || selectionCount !== 1)) {
      return new Error('Select one region, or edges forming one closed loop.')
    }
    if (solvedSegmentCount > 0 && solvedSegmentCount !== selectionCount) {
      return new Error('Select edges from a sketch or from a surface.')
    }

    for (const primitiveEdge of primitiveEdges) {
      const primitiveResult = getEdgeProfileExprsFromSelection({
        selections: { graphSelections: [], otherSelections: [primitiveEdge] },
        modifiedAst,
        artifactGraph,
        wasmInstance,
      })
      if (isErr(primitiveResult)) return primitiveResult
      modifiedAst = primitiveResult.modifiedAst
      exprs.push(...primitiveResult.exprs)
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

    if (exprs.length !== selectionCount) {
      return new Error('Could not resolve all selected curves in code.')
    }
    // The stdlib takes one Sketch directly, but requires arrays for curves,
    // including a single closed curve such as a circle.
    curvesExpr = sketchCount > 0 ? exprs[0] : createArrayExpression(exprs)
    if (curvesExpr.type === 'PipeSubstitution') curvesExpr = null
  }

  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Planar Surface'),
    curvesExpr,
    tolerance ? [createLabeledArg('tolerance', valueOrVariable(tolerance))] : []
  )
  if (tolerance && 'variableName' in tolerance && tolerance.variableName) {
    const targetPath = mNodeToEdit ?? pathIfPipe
    const targetIndex = targetPath?.[1]?.[0]
    insertVariableAndOffsetPathToNode(
      tolerance,
      modifiedAst,
      typeof targetIndex === 'number' && tolerance.insertIndex <= targetIndex
        ? targetPath
        : undefined
    )
  }
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SURFACE,
    wasmInstance,
  })
  if (isErr(pathToNode)) return pathToNode
  return { modifiedAst, pathToNode }
}
