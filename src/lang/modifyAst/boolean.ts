import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
} from '@src/lang/create'
import {
  getNodeFromPath,
  getVariableExprsFromSelection,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { getFaceCodeRef } from '@src/lang/std/artifactGraph'
import type {
  Artifact,
  ArtifactGraph,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import {
  createVariableExpressionsArray,
  setCallInAst,
} from '@src/lang/modifyAst'

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
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled arguments (no exposed labeled arguments for boolean yet)
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    modifiedAst,
    nodeToEdit,
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
    pathToEdit: nodeToEdit,
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
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled arguments (no exposed labeled arguments for boolean yet)
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    modifiedAst,
    nodeToEdit,
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
    pathToEdit: nodeToEdit,
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
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled and labeled arguments
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    modifiedAst,
    nodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  const toolVars = getVariableExprsFromSelection(
    tools,
    modifiedAst,
    nodeToEdit,
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

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
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
      }
      result.push(resultId)
    } else {
      if (childrenIdOrIds) {
        stack.push(childrenIdOrIds)
      }
      result.push(resultId)
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

  const resultSet = new Set(result)
  const codeRefArtifacts = getArtifacts(Array.from(resultSet))
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
