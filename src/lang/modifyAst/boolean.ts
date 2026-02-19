import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  setCallInAst,
} from '@src/lang/modifyAst'
import { getVariableExprsFromSelection } from '@src/lang/queryAst'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

// TODO this is probably the wrong approach because we're going to get rid of `graphSelections` entirely
// and replace it with `graphSelectionsV2`, so normalising to `graphSelections` is going to mean more refactoring
// later, but at least it's working and tsc will tell us most/all of the places that need to be updated.
function normalizeSelectionsForBoolean(
  selection: Selections,
  artifactGraph: ArtifactGraph
): Selections {
  const normalizedV2GraphSelections = (selection.graphSelectionsV2 || [])
    .map((v2Selection) => {
      const entityRef = v2Selection.entityRef
      let entityId: string | undefined
      if (entityRef) {
        if (entityRef.type === 'solid3d') {
          entityId = entityRef.solid3dId
        } else if (entityRef.type === 'solid2d') {
          entityId = entityRef.solid2dId
        } else if (entityRef.type === 'face') {
          entityId = entityRef.faceId
        } else if (entityRef.type === 'plane') {
          entityId = entityRef.planeId
        }
      }

      const codeRef =
        v2Selection.codeRef ||
        (entityId
          ? getCodeRefsByArtifactId(entityId, artifactGraph)?.[0]
          : null)
      if (!codeRef) return null

      const artifact = entityId ? artifactGraph.get(entityId) : undefined
      if (artifact) {
        return { artifact, codeRef }
      }
      return { codeRef }
    })
    .filter(
      (
        graphSelection
      ): graphSelection is {
        codeRef: NonNullable<typeof graphSelection>['codeRef']
      } => Boolean(graphSelection)
    )

  return {
    graphSelections: [
      ...selection.graphSelections,
      ...normalizedV2GraphSelections,
    ],
    otherSelections: selection.otherSelections,
    graphSelectionsV2: [],
  }
}

export function addUnion({
  ast,
  artifactGraph,
  solids,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const normalizedSolids = normalizeSelectionsForBoolean(solids, artifactGraph)

  // 2. Prepare unlabeled arguments (no exposed labeled arguments for boolean yet)
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    normalizedSolids,
    modifiedAst,
    wasmInstance,
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

export function addIntersect({
  ast,
  artifactGraph,
  solids,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const normalizedSolids = normalizeSelectionsForBoolean(solids, artifactGraph)

  // 2. Prepare unlabeled arguments (no exposed labeled arguments for boolean yet)
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    normalizedSolids,
    modifiedAst,
    wasmInstance,
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

export function addSubtract({
  ast,
  artifactGraph,
  solids,
  tools,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  tools: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const normalizedSolids = normalizeSelectionsForBoolean(solids, artifactGraph)
  const normalizedTools = normalizeSelectionsForBoolean(tools, artifactGraph)

  // 2. Prepare unlabeled and labeled arguments
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    normalizedSolids,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    lastChildLookup,
    artifactGraph,
    ['compositeSolid', 'sweep']
  )
  if (err(vars)) {
    return vars
  }

  const toolVars = getVariableExprsFromSelection(
    normalizedTools,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    lastChildLookup,
    artifactGraph,
    ['compositeSolid', 'sweep']
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

export function addSplit({
  ast,
  artifactGraph,
  targets,
  merge,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  targets: Selections
  merge: boolean
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const normalizedTargets = normalizeSelectionsForBoolean(targets, artifactGraph)

  // 2. Prepare unlabeled and labeled arguments
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    normalizedTargets,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    lastChildLookup,
    artifactGraph,
    ['compositeSolid', 'sweep']
  )
  if (err(vars)) {
    return vars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('split', objectsExpr, [
    createLabeledArg('merge', createLiteral(merge, wasmInstance)),
  ])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathIfNewPipe: vars.pathIfPipe,
    pathToEdit: mNodeToEdit,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SPLIT,
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
