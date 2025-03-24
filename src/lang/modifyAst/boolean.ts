import { Node } from '@rust/kcl-lib/bindings/Node'
import EditorManager from 'editor/manager'
import { get } from 'http'
import CodeManager from 'lang/codeManager'
import { KclManager } from 'lang/KclSingleton'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
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
import { Selection } from 'lib/selections'
import { err } from 'lib/trap'
import { isArray } from 'lib/utils'

export async function applySubtractFromTargetOperatorSelections(
  target: Selection,
  operator: Selection,
  dependencies: {
    kclManager: KclManager
    engineCommandManager: EngineCommandManager
    codeManager: CodeManager
  }
): Promise<Error | void> {
  const ast = dependencies.kclManager.ast
  if (!target.artifact || !operator.artifact) {
    return new Error('No artifact found')
  }
  const orderedArtifactLeafsTarget = findAllLeafArtifacts(
    target.artifact,
    dependencies.engineCommandManager.artifactGraph
  )
  const operatorArtifactLeafs = findAllLeafArtifacts(
    operator.artifact,
    dependencies.engineCommandManager.artifactGraph
  )

  const targetLastVar = getLastVariable(orderedArtifactLeafsTarget, ast)
  const lastVar = getLastVariable(operatorArtifactLeafs, ast)

  if (!targetLastVar || !lastVar) {
    return new Error('No variable found')
  }
  const modifiedAst = booleanSubtractAstMod({
    ast,
    targets: [targetLastVar?.variableDeclaration?.node],
    tools: [lastVar?.variableDeclaration.node],
  })
  const updateAstResult = await dependencies.kclManager.updateAst(
    modifiedAst,
    false
  )
  await dependencies.codeManager.updateEditorWithAstAndWriteToFile(
    updateAstResult.newAst
  )
  await dependencies.kclManager.updateAst(modifiedAst, true)
}

export function findAllLeafArtifacts(
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
      varDecs.map((varDec) => createIdentifier(varDec.declaration.id.name))
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
