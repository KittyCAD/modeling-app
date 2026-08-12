import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
} from '@src/lang/create'
import { traverse } from '@src/lang/queryAst'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program, SourceRange } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function convertLegacyAngleToAngleDimension(
  ast: Node<Program>,
  sourceRange: SourceRange,
  sector: number,
  inverse: boolean,
  instance: ModuleType
): Node<Program> | Error {
  const modifiedAst = structuredClone(ast)
  let converted = false

  traverse(modifiedAst, {
    enter(node) {
      if (
        converted ||
        node.type !== 'CallExpressionKw' ||
        node.start !== sourceRange[0] ||
        node.end !== sourceRange[1] ||
        node.moduleId !== sourceRange[2] ||
        node.callee.name.name !== 'angle' ||
        node.unlabeled === null
      ) {
        return
      }

      const lines = node.unlabeled
      node.callee.name.name = 'angleDimension'
      node.unlabeled = null
      node.arguments = [
        createLabeledArg('lines', lines),
        createLabeledArg('sector', createLiteral(sector, instance)),
        ...(inverse
          ? [createLabeledArg('inverse', createLiteral(true, instance))]
          : []),
        ...node.arguments,
      ]
      converted = true
    },
  })

  return converted
    ? modifiedAst
    : new Error('Could not find the legacy angle call for this refactor')
}

export function convertLegacyAngleToParallel(
  ast: Node<Program>,
  sourceRange: SourceRange
): Node<Program> | Error {
  const modifiedAst = structuredClone(ast)
  let converted = false

  traverse(modifiedAst, {
    enter(node) {
      if (
        converted ||
        node.type !== 'ExpressionStatement' ||
        node.expression.type !== 'BinaryExpression' ||
        node.expression.operator !== '=='
      ) {
        return
      }

      const binary = node.expression
      const angleCall = [binary.left, binary.right].find(
        (part) =>
          part.type === 'CallExpressionKw' &&
          part.start === sourceRange[0] &&
          part.end === sourceRange[1] &&
          part.moduleId === sourceRange[2] &&
          part.callee.name.name === 'angle' &&
          part.unlabeled !== null
      )
      if (
        angleCall?.type !== 'CallExpressionKw' ||
        angleCall.unlabeled === null
      ) {
        return
      }

      node.expression = createCallExpressionStdLibKw(
        'parallel',
        structuredClone(angleCall.unlabeled),
        []
      )
      converted = true
    },
  })

  return converted
    ? modifiedAst
    : new Error('Could not find the legacy parallel-angle constraint')
}
