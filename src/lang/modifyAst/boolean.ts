import type { Node } from '@rust/kcl-lib/bindings/Node'

import type EditorManager from '@src/editor/manager'
import type { KclManager } from '@src/lang/KclSingleton'
import type CodeManager from '@src/lang/codeManager'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { getFaceCodeRef } from '@src/lang/std/artifactGraph'
import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import type {
  Artifact,
  ArtifactGraph,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import type { Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'

export async function applySubtractFromTargetOperatorSelections(
  solids: Selections,
  tools: Selections,
  dependencies: {
    kclManager: KclManager
    engineCommandManager: EngineCommandManager
    codeManager: CodeManager
    editorManager: EditorManager
  }
): Promise<Error | void> {
  const ast = dependencies.kclManager.ast
  const lastSolidsVars = getLastVariableDeclarationsFromSelections(
    solids,
    ast,
    dependencies.kclManager.artifactGraph
  )
  if (err(lastSolidsVars) || lastSolidsVars.length < 1) {
    console.log(lastSolidsVars)
    return new Error('Not enough or invalid solids variables found')
  }

  const lastToolsVars = getLastVariableDeclarationsFromSelections(
    tools,
    ast,
    dependencies.kclManager.artifactGraph
  )
  if (err(lastToolsVars) || lastToolsVars.length < 1) {
    return new Error('Not enough or invalid tools variables found')
  }

  const modifiedAst = booleanSubtractAstMod({
    ast,
    solids: lastSolidsVars,
    tools: lastToolsVars,
  })

  await updateModelingState(modifiedAst, EXECUTION_TYPE_REAL, dependencies)
}

export async function applyUnionFromTargetOperatorSelections(
  solids: Selections,
  dependencies: {
    kclManager: KclManager
    engineCommandManager: EngineCommandManager
    codeManager: CodeManager
    editorManager: EditorManager
  }
): Promise<Error | void> {
  const ast = dependencies.kclManager.ast
  const lastVars = getLastVariableDeclarationsFromSelections(
    solids,
    ast,
    dependencies.kclManager.artifactGraph
  )
  if (err(lastVars) || lastVars.length < 2) {
    return new Error('Not enough or invalid solids variables found')
  }

  const modifiedAst = booleanUnionAstMod({
    ast,
    solids: lastVars,
  })
  await updateModelingState(modifiedAst, EXECUTION_TYPE_REAL, dependencies)
}

export async function applyIntersectFromTargetOperatorSelections(
  solids: Selections,
  dependencies: {
    kclManager: KclManager
    engineCommandManager: EngineCommandManager
    codeManager: CodeManager
    editorManager: EditorManager
  }
): Promise<Error | void> {
  const ast = dependencies.kclManager.ast
  const lastVars = getLastVariableDeclarationsFromSelections(
    solids,
    ast,
    dependencies.kclManager.artifactGraph
  )
  if (err(lastVars) || lastVars.length < 2) {
    return new Error('Not enough or invalid solids variables found')
  }

  const modifiedAst = booleanIntersectAstMod({
    ast,
    solids: lastVars,
  })
  await updateModelingState(modifiedAst, EXECUTION_TYPE_REAL, dependencies)
}

function getLastVariableDeclarationsFromSelections(
  selections: Selections,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph
): Error | VariableDeclaration[] {
  const artifacts: Artifact[] = []
  for (const selection of selections.graphSelections) {
    if (selection.artifact) {
      artifacts.push(selection.artifact)
    }
  }

  const orderedChildrenEach = artifacts.map((artifact) =>
    findAllChildrenAndOrderByPlaceInCode(artifact, artifactGraph)
  )

  const lastVars: VariableDeclaration[] = []
  for (const orderedArtifactLeaves of orderedChildrenEach) {
    const lastVar = getLastVariable(orderedArtifactLeaves, ast)
    if (!lastVar) continue
    lastVars.push(lastVar.variableDeclaration.node)
  }

  return lastVars
}

/** returns all children of a given artifact, and sorts them DESC by start sourceRange
 * The usecase is we want the last declare relevant  child to use in the boolean operations
 * but might be useful else where.
 */
export function findAllChildrenAndOrderByPlaceInCode(
  artifact: Artifact,
  artifactGraph: ArtifactGraph
): Artifact[] {
  const result: string[] = []
  const stack: string[] = [artifact.id]

  const getArtifacts = (stringIds: string[]): Artifact[] => {
    const artifactsWithCodeRefs: Artifact[] = []
    for (const id of stringIds) {
      const artifact = artifactGraph.get(id)
      if (artifact) {
        const codeRef = getFaceCodeRef(artifact)
        if (codeRef && codeRef.range[1] > 0) {
          artifactsWithCodeRefs.push(artifact)
        }
      }
    }
    return artifactsWithCodeRefs
  }

  const pushToSomething = (
    resultId: string,
    childrenIdOrIds: string | string[] | null | undefined
  ) => {
    if (isArray(childrenIdOrIds)) {
      if (childrenIdOrIds.length) {
        stack.push(...childrenIdOrIds)
        result.push(resultId)
      }
    } else {
      if (childrenIdOrIds) {
        stack.push(childrenIdOrIds)
        result.push(resultId)
      }
    }
  }

  while (stack.length > 0) {
    const currentId = stack.pop()!
    const current = artifactGraph.get(currentId)
    if (current?.type === 'path') {
      pushToSomething(currentId, current?.sweepId)
      pushToSomething(currentId, current?.segIds)
    } else if (current?.type === 'sweep') {
      pushToSomething(currentId, current?.surfaceIds)
      const path = artifactGraph.get(current.pathId)
      if (path && path.type === 'path') {
        const compositeSolidId = path.compositeSolidId
        if (compositeSolidId) {
          result.push(compositeSolidId)
        }
      }
    } else if (current?.type === 'wall' || current?.type === 'cap') {
      pushToSomething(currentId, current?.pathIds)
    } else if (current?.type === 'segment') {
      pushToSomething(currentId, current?.edgeCutId)
      pushToSomething(currentId, current?.surfaceId)
    } else if (current?.type === 'edgeCut') {
      pushToSomething(currentId, current?.surfaceId)
    } else if (current?.type === 'startSketchOnPlane') {
      pushToSomething(currentId, current?.planeId)
    } else if (current?.type === 'plane') {
      pushToSomething(currentId, current.pathIds)
    }
  }

  const codeRefArtifacts = getArtifacts(result)
  const orderedByCodeRefDest = codeRefArtifacts.sort((a, b) => {
    const aCodeRef = getFaceCodeRef(a)
    const bCodeRef = getFaceCodeRef(b)
    if (!aCodeRef || !bCodeRef) {
      return 0
    }
    return bCodeRef.range[0] - aCodeRef.range[0]
  })

  return orderedByCodeRefDest
}

/** Returns the last declared in code, relevant child */
export function getLastVariable(
  orderedDescArtifacts: Artifact[],
  ast: Node<Program>
) {
  for (const artifact of orderedDescArtifacts) {
    const codeRef = getFaceCodeRef(artifact)
    if (codeRef) {
      const pathToNode = getNodePathFromSourceRange(ast, codeRef.range)
      const varDec = getNodeFromPath<VariableDeclaration>(
        ast,
        pathToNode,
        'VariableDeclaration'
      )
      if (!err(varDec)) {
        return {
          variableDeclaration: varDec,
          pathToNode: pathToNode,
          artifact,
        }
      }
    }
  }
  return null
}

export function booleanSubtractAstMod({
  ast,
  solids,
  tools,
}: {
  ast: Node<Program>
  solids: VariableDeclaration[]
  tools: VariableDeclaration[]
}): Node<Program> {
  const newAst = structuredClone(ast)
  const newVarName = findUniqueName(newAst, 'solid')
  const createArrExpr = (varDecs: VariableDeclaration[]) => {
    const names = varDecs.map((varDec) =>
      createLocalName(varDec.declaration.id.name)
    )
    return names.length === 1 ? names[0] : createArrayExpression(names)
  }
  const solidsArrayExpression = createArrExpr(solids)
  const toolsArrayExpression = createArrExpr(tools)

  const newVarDec = createVariableDeclaration(
    newVarName,
    createCallExpressionStdLibKw('subtract', solidsArrayExpression, [
      createLabeledArg('tools', toolsArrayExpression),
    ])
  )
  newAst.body.push(newVarDec)
  return newAst
}

export function booleanUnionAstMod({
  ast,
  solids,
}: {
  ast: Node<Program>
  solids: VariableDeclaration[]
}): Node<Program> {
  const newAst = structuredClone(ast)
  const newVarName = findUniqueName(newAst, 'solid')
  const createArrExpr = (varDecs: VariableDeclaration[]) =>
    createArrayExpression(
      varDecs.map((varDec) => createLocalName(varDec.declaration.id.name))
    )
  const solidsArrayExpression = createArrExpr(solids)

  const newVarDec = createVariableDeclaration(
    newVarName,
    createCallExpressionStdLibKw('union', solidsArrayExpression, [])
  )
  newAst.body.push(newVarDec)
  return newAst
}

export function booleanIntersectAstMod({
  ast,
  solids,
}: {
  ast: Node<Program>
  solids: VariableDeclaration[]
}): Node<Program> {
  const newAst = structuredClone(ast)
  const newVarName = findUniqueName(newAst, 'solid')
  const createArrExpr = (varDecs: VariableDeclaration[]) =>
    createArrayExpression(
      varDecs.map((varDec) => createLocalName(varDec.declaration.id.name))
    )
  const solidsArrayExpression = createArrExpr(solids)

  const newVarDec = createVariableDeclaration(
    newVarName,
    createCallExpressionStdLibKw('intersect', solidsArrayExpression, [])
  )
  newAst.body.push(newVarDec)
  return newAst
}
