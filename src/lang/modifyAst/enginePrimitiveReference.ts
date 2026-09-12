import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import { insertVariableAndOffsetPathToNode } from '@src/lang/modifyAst'
import type {
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
export function createPrimitiveIndexCallExpression(
  functionName: 'faceId' | 'edgeId',
  bodyExpr: Expr,
  primitiveIndex: number,
  wasmInstance: ModuleType
): Node<CallExpressionKw> {
  return createCallExpressionStdLibKw(functionName, bodyExpr, [
    createLabeledArg('index', createLiteral(primitiveIndex, wasmInstance)),
  ])
}

export function createBodyOfCallExpression(
  bodyExpr: Expr,
  bodyPath: number[],
  wasmInstance: ModuleType
): Node<CallExpressionKw> {
  return createCallExpressionStdLibKw('bodyOf', bodyExpr, [
    createLabeledArg(
      'path',
      createArrayExpression(
        bodyPath.map((index) => createLiteral(index, wasmInstance))
      )
    ),
  ])
}

export function createPrimitiveBodyExpression(
  bodyExpr: Expr,
  bodyPath: number[] | undefined,
  wasmInstance: ModuleType
): Expr {
  return bodyPath?.length
    ? createBodyOfCallExpression(bodyExpr, bodyPath, wasmInstance)
    : bodyExpr
}

export function getRootBodyOfInputExpression(
  bodyExpr: Expr,
  ast: Node<Program>
): Expr {
  let current = structuredClone(bodyExpr)
  const visitedNames = new Set<string>()

  while (true) {
    if (
      current.type === 'CallExpressionKw' &&
      current.callee.name.name === 'bodyOf' &&
      current.unlabeled
    ) {
      current = structuredClone(current.unlabeled)
      continue
    }

    if (current.type !== 'Name' || current.path.length > 0) {
      return current
    }

    const name = current.name.name
    if (visitedNames.has(name)) {
      return current
    }
    visitedNames.add(name)

    const declaration = ast.body.find(
      (item) =>
        item.type === 'VariableDeclaration' && item.declaration.id.name === name
    )
    if (
      declaration?.type !== 'VariableDeclaration' ||
      declaration.declaration.init.type !== 'CallExpressionKw' ||
      declaration.declaration.init.callee.name.name !== 'bodyOf' ||
      !declaration.declaration.init.unlabeled
    ) {
      return current
    }

    current = structuredClone(declaration.declaration.init.unlabeled)
  }
}

export function insertBodyOfVariableAndOffsetPathToNode({
  bodyExpr,
  bodyPath,
  modifiedAst,
  wasmInstance,
  insertIndex,
  pathToNode,
}: {
  bodyExpr: Expr
  bodyPath: number[] | undefined
  modifiedAst: Node<Program>
  wasmInstance: ModuleType
  insertIndex: number
  pathToNode?: PathToNode
}): { bodyExpr: Expr; inserted: boolean } {
  if (!bodyPath?.length) {
    return { bodyExpr, inserted: false }
  }

  const bodyOfExpr = createBodyOfCallExpression(
    structuredClone(bodyExpr),
    bodyPath,
    wasmInstance
  )
  const bodyVariableName = findUniqueName(
    modifiedAst,
    KCL_DEFAULT_CONSTANT_PREFIXES.BODY
  )
  const bodyIdentifierAst = createLocalName(bodyVariableName)
  insertVariableAndOffsetPathToNode(
    {
      valueAst: bodyOfExpr,
      valueText: '',
      valueCalculated: '',
      variableName: bodyVariableName,
      variableDeclarationAst: createVariableDeclaration(
        bodyVariableName,
        bodyOfExpr
      ),
      variableIdentifierAst: bodyIdentifierAst,
      insertIndex,
    },
    modifiedAst,
    pathToNode
  )

  return { bodyExpr: bodyIdentifierAst, inserted: true }
}
