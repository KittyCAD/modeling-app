import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  setCallInAst,
} from '@src/lang/modifyAst'
import { getAxisExpression } from '@src/lang/modifyAst/sweeps'
import {
  getNodeFromPath,
  getVariableExprsFromSelection,
} from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  Expr,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

export function addMirror({
  ast,
  artifactGraph,
  bodies,
  across,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
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
  ast,
  wasmInstance,
  nodeToEdit,
}: {
  across: Selections
  artifactGraph: ArtifactGraph
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

  const planeSelection = across.graphSelections.find(
    (selection) => selection.artifact?.type === 'plane'
  )
  if (planeSelection) {
    const variable = getNodeFromPath<VariableDeclaration>(
      ast,
      planeSelection.codeRef.pathToNode,
      wasmInstance,
      'VariableDeclaration'
    )
    if (err(variable)) {
      return variable
    }

    const init = variable.node.declaration?.init
    if (
      init?.type !== 'CallExpressionKw' ||
      init.callee.name.name !== 'offsetPlane'
    ) {
      return new Error('Selected mirror reference must be an offset plane')
    }

    return {
      modifiedAst: ast,
      expr: createLocalName(variable.node.declaration.id.name),
    }
  }

  const vars = getVariableExprsFromSelection(
    across,
    artifactGraph,
    ast,
    wasmInstance,
    nodeToEdit
  )
  if (err(vars)) {
    return vars
  }

  const expr = createVariableExpressionsArray(vars.exprs)
  if (!expr || expr.type === 'PipeSubstitution') {
    return new Error('No mirror reference provided')
  }

  return { modifiedAst: ast, expr }
}
