import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  setCallInAst,
} from '@src/lang/modifyAst'
import { getPlaneExprFromSelection } from '@src/lang/modifyAst/faces'
import { getAxisExpression } from '@src/lang/modifyAst/sweeps'
import { getVariableExprsFromSelection } from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  Expr,
  PathToNode,
  Program,
  VariableMap,
} from '@src/lang/wasm'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

export function addMirror({
  ast,
  artifactGraph,
  variables,
  bodies,
  across,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  variables: VariableMap
  bodies: Selections
  across: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  const vars = getVariableExprsFromSelection(
    bodies,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
      artifactTypeFilter: ['compositeSolid', 'sweep'],
    }
  )
  if (err(vars)) {
    return vars
  }

  const acrossExpr = getMirrorAcrossExpression({
    across,
    artifactGraph,
    variables,
    ast: modifiedAst,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(acrossExpr)) {
    return acrossExpr
  }
  modifiedAst = acrossExpr.modifiedAst

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('mirror3d', objectsExpr, [
    createLabeledArg('across', acrossExpr.expr),
  ])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SOLID,
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

function getMirrorAcrossExpression({
  across,
  artifactGraph,
  variables,
  ast,
  wasmInstance,
  nodeToEdit,
}: {
  across: Selections
  artifactGraph: ArtifactGraph
  variables: VariableMap
  ast: Node<Program>
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; expr: Expr } {
  const isEdgeSelection = across.graphSelections.some(
    (selection) =>
      selection.artifact?.type === 'segment' ||
      selection.artifact?.type === 'sweepEdge' ||
      selection.artifact?.type === 'edgeCutEdge'
  )

  if (isEdgeSelection) {
    const result = getAxisExpression(
      undefined,
      across,
      ast,
      wasmInstance,
      artifactGraph,
      nodeToEdit
    )
    if (err(result)) {
      return result
    }

    return {
      modifiedAst: result.modifiedAst,
      expr: result.generatedAxis,
    }
  }

  return getPlaneExprFromSelection({
    ast,
    artifactGraph,
    variables,
    plane: across,
    wasmInstance,
    nodeToEdit,
  })
}
