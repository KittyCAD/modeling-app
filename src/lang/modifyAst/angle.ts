import { createLabeledArg, createLiteral } from '@src/lang/create'
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
