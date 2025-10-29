import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  setCallInAst,
} from '@src/lang/modifyAst'
import { getVariableExprsFromSelection } from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'

export function addUnion({
  ast,
  artifactGraph,
  solids,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled arguments (no exposed labeled arguments for boolean yet)
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    modifiedAst,
    mNodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('union', objectsExpr, [])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SOLID,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addIntersect({
  ast,
  artifactGraph,
  solids,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled arguments (no exposed labeled arguments for boolean yet)
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    modifiedAst,
    mNodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('intersect', objectsExpr, [])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SOLID,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addSubtract({
  ast,
  artifactGraph,
  solids,
  tools,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  tools: Selections
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    modifiedAst,
    mNodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  const toolVars = getVariableExprsFromSelection(
    tools,
    modifiedAst,
    mNodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(toolVars)) {
    return toolVars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const toolsExpr = createVariableExpressionsArray(toolVars.exprs)
  if (toolsExpr === null) {
    return new Error('No tools provided for subtraction operation')
  }

  const call = createCallExpressionStdLibKw('subtract', objectsExpr, [
    createLabeledArg('tools', toolsExpr),
  ])
  if (vars.pathIfPipe && toolVars.pathIfPipe) {
    return new Error(
      'Cannot use both solids and tools in a subtraction operation with a pipe'
    )
  }

  const pathIfNewPipe = vars.pathIfPipe ?? toolVars.pathIfPipe

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathIfNewPipe,
    pathToEdit: mNodeToEdit,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SOLID,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}
