import type { IconName } from '@kittycad/ui-kit'
import { iconNames } from '@kittycad/ui-kit'
import type { BodyItem } from '@rust/kcl-lib/bindings/BodyItem'
import type { Expr } from '@rust/kcl-lib/bindings/Expr'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { byteOffsetToUtf16 } from '@src/lib/kcl/sourceRange'

/** A parsed root statement which execution has not reached past `exit()`. */
export interface SourceOutlineNode {
  key: string
  label: string
  kind: string
  icon: IconName
  sourceRange: SourceRange
  statement: { from: number; to: number }
  rollbackInsertion: number
}

const availableIcons = new Set<string>(iconNames)

const sentenceCase = (value: string) => {
  const words = value
    .split('::')
    .at(-1)
    ?.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim()
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : value
}

const callName = (expression: Expr): string | null =>
  expression.type === 'CallExpressionKw' ? expression.callee.name.name : null

const expressionOf = (item: BodyItem): Expr | null => {
  switch (item.type) {
    case 'VariableDeclaration':
      return item.declaration.init
    case 'ExpressionStatement':
      return item.expression
    default:
      return null
  }
}

function describe(item: BodyItem): {
  label: string
  kind: string
  icon: IconName
  sourceRange: SourceRange
} | null {
  if (item.type === 'ImportStatement') {
    const label =
      item.path.type === 'Kcl'
        ? item.path.filename
        : item.path.type === 'Foreign'
          ? item.path.path
          : item.path.path.join('::')
    return {
      label,
      kind: 'Module',
      icon: 'import',
      sourceRange: [item.start, item.end, item.moduleId],
    }
  }

  const expression = expressionOf(item)
  if (!expression) {
    return null
  }

  const name = callName(expression)
  if (name === 'exit' || name === 'hide') {
    return null
  }
  if (name) {
    const candidate = name.split('::').at(-1) ?? name
    return {
      label: sentenceCase(name),
      kind: 'Operation',
      icon: availableIcons.has(candidate) ? (candidate as IconName) : 'command',
      sourceRange: [expression.start, expression.end, expression.moduleId],
    }
  }

  if (item.type !== 'VariableDeclaration') {
    return null
  }
  const label = item.declaration.id.name
  if (expression.type === 'SketchBlock') {
    return {
      label: 'Sketch',
      kind: 'Sketch',
      icon: 'sketch',
      sourceRange: [expression.start, expression.end, expression.moduleId],
    }
  }
  if (expression.type === 'FunctionExpression') {
    return {
      label,
      kind: 'Function',
      icon: 'function',
      sourceRange: [expression.start, expression.end, expression.moduleId],
    }
  }

  return {
    label,
    kind: expression.type === 'PipeExpression' ? 'Operation' : 'Parameter',
    icon: expression.type === 'PipeExpression' ? 'command' : 'code',
    sourceRange: [expression.start, expression.end, expression.moduleId],
  }
}

const startOfLine = (source: string, offset: number) =>
  source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1

/**
 * Recover the honest, unbuilt suffix of the feature tree from the parsed file.
 * Runtime operations remain authoritative above the boundary; these nodes only
 * fill the gap caused by `exit()` deliberately ending the runtime trace.
 */
export function sourceOutlineAfter(
  source: string,
  program: Program,
  offset: number
): SourceOutlineNode[] {
  return program.body.flatMap((item, index) => {
    const statementFrom = byteOffsetToUtf16(source, item.start)
    if (statementFrom < offset) {
      return []
    }
    const description = describe(item)
    if (!description) {
      return []
    }
    const statementTo = byteOffsetToUtf16(source, item.end)
    const commentFrom = byteOffsetToUtf16(source, item.commentStart)
    const boundaryFrom =
      item.commentStart > 0 && item.commentStart < item.start
        ? commentFrom
        : statementFrom

    return [
      {
        key: `source:${item.moduleId}:${item.type}:${item.start}:${index}`,
        ...description,
        statement: { from: statementFrom, to: statementTo },
        rollbackInsertion: startOfLine(source, boundaryFrom),
      },
    ]
  })
}
