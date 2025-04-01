import { Node } from '@rust/kcl-lib/bindings/Node'
import EditorManager from 'editor/manager'
import CodeManager from 'lang/codeManager'
import { KclManager } from 'lang/KclSingleton'
import { updateModelingState } from 'lang/modelingWorkflows'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from 'lang/modifyAst'
import { getNodeFromPath } from 'lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { getFaceCodeRef } from 'lang/std/artifactGraph'
import { EngineCommandManager } from 'lang/std/engineConnection'
import {
  Artifact,
  ArtifactGraph,
  Program,
  VariableDeclaration,
} from 'lang/wasm'
import { EXECUTION_TYPE_REAL } from 'lib/constants'
import { Selection, Selections } from 'lib/selections'
import { err } from 'lib/trap'
import { isArray } from 'lib/utils'

export async function applySubtractFromTargetOperatorSelections(
  target: Selection,
  tool: Selection,
  dependencies: {
    kclManager: KclManager
    engineCommandManager: EngineCommandManager
    codeManager: CodeManager
    editorManager: EditorManager
  }
): Promise<Error | void> {
  const ast = dependencies.kclManager.ast
  if (!target.artifact || !tool.artifact) {
    return new Error('No artifact found')
  }
  const orderedChildrenTarget = findAllChildrenAndOrderByPlaceInCode(
    target.artifact,
    dependencies.kclManager.artifactGraph
  )
  const orderedChildrenTool = findAllChildrenAndOrderByPlaceInCode(
    tool.artifact,
    dependencies.kclManager.artifactGraph
  )

  const lastVarTarget = getLastVariable(orderedChildrenTarget, ast)
  const lastVarTool = getLastVariable(orderedChildrenTool, ast)

  if (!lastVarTarget || !lastVarTool) {
    return new Error('No variable found')
  }
  const modifiedAst = booleanSubtractAstMod({
    ast,
    targets: [lastVarTarget?.variableDeclaration?.node],
    tools: [lastVarTool?.variableDeclaration.node],
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

  const artifacts: Artifact[] = []
  for (const selection of solids.graphSelections) {
    if (selection.artifact) {
      artifacts.push(selection.artifact)
    }
  }

  if (artifacts.length < 2) {
    return new Error('Not enough artifacts selected')
  }

  const orderedChildrenEach = artifacts.map((artifact) =>
    findAllChildrenAndOrderByPlaceInCode(
      artifact,
      dependencies.kclManager.artifactGraph
    )
  )

  const lastVars: VariableDeclaration[] = []
  for (const orderedArtifactLeafs of orderedChildrenEach) {
    const lastVar = getLastVariable(orderedArtifactLeafs, ast)
    if (!lastVar) continue
    lastVars.push(lastVar.variableDeclaration.node)
  }

  if (lastVars.length < 2) {
    return new Error('Not enough variables found')
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

  const artifacts: Artifact[] = []
  for (const selection of solids.graphSelections) {
    if (selection.artifact) {
      artifacts.push(selection.artifact)
    }
  }

  if (artifacts.length < 2) {
    return new Error('Not enough artifacts selected')
  }

  const orderedChildrenEach = artifacts.map((artifact) =>
    findAllChildrenAndOrderByPlaceInCode(
      artifact,
      dependencies.kclManager.artifactGraph
    )
  )

  const lastVars: VariableDeclaration[] = []
  for (const orderedArtifactLeafs of orderedChildrenEach) {
    const lastVar = getLastVariable(orderedArtifactLeafs, ast)
    if (!lastVar) continue
    lastVars.push(lastVar.variableDeclaration.node)
  }

  if (lastVars.length < 2) {
    return new Error('Not enough variables found')
  }

  const modifiedAst = booleanIntersectAstMod({
    ast,
    solids: lastVars,
  })
  await updateModelingState(modifiedAst, EXECUTION_TYPE_REAL, dependencies)
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
    childrenIdOrIds: null | string | string[]
  ) => {
    if (isArray(childrenIdOrIds)) {
      if (childrenIdOrIds.length) {
        stack.push(...childrenIdOrIds)
        result.push(resultId)
      } else {
      }
    } else {
      if (childrenIdOrIds) {
        stack.push(childrenIdOrIds)
        result.push(resultId)
      } else {
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
  targets,
  tools,
}: {
  ast: Node<Program>
  targets: VariableDeclaration[]
  tools: VariableDeclaration[]
}): Node<Program> {
  const newAst = structuredClone(ast)
  const newVarName = findUniqueName(newAst, 'solid')
  const createArrExpr = (varDecs: VariableDeclaration[]) =>
    createArrayExpression(
      varDecs.map((varDec) => createLocalName(varDec.declaration.id.name))
    )
  const targetsArrayExpression = createArrExpr(targets)
  const toolsArrayExpression = createArrExpr(tools)

  const newVarDec = createVariableDeclaration(
    newVarName,
    createCallExpressionStdLibKw('subtract', targetsArrayExpression, [
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
