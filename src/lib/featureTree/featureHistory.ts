import type { BodyItem } from '@rust/kcl-lib/bindings/BodyItem'
import type { Expr } from '@rust/kcl-lib/bindings/Expr'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { isArray } from '@src/lib/utils'

export const ROLLBACK_CODE = 'exit() // zds:rollback\n'

export interface FeatureBlock {
  statement: BodyItem
  start: number
  end: number
  text: string
  label: string
  movable: boolean
  sourceStart: number
  sourceEnd: number
  stage?: { pipeline: number; index: number; expression: Expr }
}

export interface FeatureHistory {
  prefix: string
  blocks: FeatureBlock[]
  rollbackIndex: number
  rollbackRange?: readonly [number, number]
  code: string
}

function pipelineExpression(
  statement: BodyItem
): Extract<Expr, { type: 'PipeExpression' }> | undefined {
  const expression =
    statement.type === 'VariableDeclaration'
      ? statement.declaration.init
      : statement.type === 'ExpressionStatement'
        ? statement.expression
        : undefined
  return expression?.type === 'PipeExpression' ? expression : undefined
}

export function isGlobImport(statement: BodyItem): boolean {
  // The generated Glob selector intersects Node<null>, which TypeScript
  // reduces to never even though the parser returns this variant at runtime.
  const selector: unknown =
    statement.type === 'ImportStatement' ? statement.selector : undefined
  return (
    selector !== null &&
    typeof selector === 'object' &&
    'type' in selector &&
    selector.type === 'Glob'
  )
}

/** Build editable source blocks from the AST, never by splitting KCL on lines. */
export function getFeatureHistory(
  ast: Node<Program>,
  code: string
): FeatureHistory {
  // Convert all byte ranges in one pass. Re-encoding the entire program for
  // each statement makes large feature trees quadratic in source length.
  const bytes = new TextEncoder().encode(code)
  const offsets = [
    ...new Set(
      ast.body.flatMap((statement) => [
        statement.start,
        statement.end,
        statement.commentStart,
        ...(statement.outerAttrs ?? []).map((attr) => attr.start),
        ...(pipelineExpression(statement)?.body ?? []).flatMap((expr) => [
          expr.start,
          expr.end,
        ]),
        ...Object.values(
          pipelineExpression(statement)?.nonCodeMeta?.nonCodeNodes ?? {}
        ).flatMap((comments) => comments.map((comment) => comment.start)),
      ])
    ),
  ].sort((a, b) => a - b)
  const positions = new Map<number, number>()
  const decoder = new TextDecoder()
  let previous = 0
  let position = 0
  for (const offset of offsets) {
    position += decoder.decode(bytes.subarray(previous, offset)).length
    positions.set(offset, position)
    previous = offset
  }
  const utf16 = (offset: number) => positions.get(offset) ?? 0
  const starts = ast.body.map((statement) => {
    const offset = Math.min(
      statement.start,
      statement.commentStart,
      ...(statement.outerAttrs ?? []).map((attr) => attr.start)
    )
    return utf16(offset)
  })
  const blocks: FeatureBlock[] = []
  let pendingComments = ''
  let rollbackIndex: number | undefined
  let rollbackRange: readonly [number, number] | undefined
  for (const [index, statement] of ast.body.entries()) {
    const start = starts[index]
    const end = starts[index + 1] ?? code.length
    const pipeline = pipelineExpression(statement)
    const expressions = pipeline?.body
    const stageStarts = expressions?.map((expr, stageIndex) => {
      if (stageIndex === 0) return start
      const comment = pipeline?.nonCodeMeta?.nonCodeNodes[stageIndex - 1]?.find(
        (node) => node.value.type === 'blockComment'
      )
      if (comment) {
        const commentStart = utf16(comment.start)
        const lineStart = code.lastIndexOf('\n', commentStart - 1) + 1
        return code.slice(lineStart, commentStart).trim() === ''
          ? lineStart
          : commentStart
      }
      const operator = code.lastIndexOf('|>', utf16(expr.start))
      const lineStart = code.lastIndexOf('\n', operator - 1) + 1
      return code.slice(lineStart, operator).trim() === ''
        ? lineStart
        : operator
    }) ?? [start]
    let stageIndex = 0
    for (const [partIndex, partStart] of stageStarts.entries()) {
      const partEnd = stageStarts[partIndex + 1] ?? end
      const text = pendingComments + code.slice(partStart, partEnd)
      pendingComments = ''
      const expression = expressions?.[partIndex]
      const rawExpression =
        expression ??
        (statement.type === 'ExpressionStatement'
          ? statement.expression
          : undefined)
      const marker = partIndex > 0 ? '|> ' + ROLLBACK_CODE : ROLLBACK_CODE
      if (
        rawExpression &&
        code.slice(utf16(rawExpression.start), utf16(rawExpression.end)) ===
          'exit()' &&
        text.split('\n')[0].trim() === marker.trim() &&
        rollbackIndex === undefined
      ) {
        rollbackIndex = blocks.length
        rollbackRange = [rawExpression.start, rawExpression.end]
        const newline = text.indexOf('\n')
        pendingComments = newline < 0 ? '' : text.slice(newline + 1)
        continue
      }
      blocks.push({
        statement,
        start: partStart,
        end: partEnd,
        text,
        sourceStart: expression?.start ?? statement.start,
        sourceEnd: expression?.end ?? statement.end,
        stage: expression
          ? { pipeline: statement.start, index: stageIndex++, expression }
          : undefined,
        label:
          partIndex > 0 && expression?.type === 'CallExpressionKw'
            ? expression.callee.name.name
            : statement.type === 'VariableDeclaration'
              ? statement.declaration.id.name
              : statement.type === 'TypeDeclaration'
                ? statement.name.name
                : code
                    .slice(utf16(statement.start), utf16(statement.end))
                    .split('\n')[0],
        movable:
          statement.type !== 'ImportStatement' &&
          statement.type !== 'TypeDeclaration',
      })
    }
  }
  if (pendingComments && blocks.length > 0)
    blocks[blocks.length - 1].text += pendingComments
  return {
    prefix:
      code.slice(0, starts[0] ?? code.length) +
      (blocks.length === 0 ? pendingComments : ''),
    blocks,
    rollbackIndex: rollbackIndex ?? blocks.length,
    rollbackRange,
    code,
  }
}

export function setHistoryRollback(
  history: FeatureHistory,
  index: number
): string {
  const newline = history.code.includes('\r\n') ? '\r\n' : '\n'
  const marker = ROLLBACK_CODE.replaceAll('\n', newline)
  const parts = history.blocks.map((block, blockIndex) => {
    const stagePrefix =
      block.stage && block.stage.index > 0
        ? (block.text.match(/^[ \t]*/)?.[0] ?? '') + '|> '
        : ''
    return (blockIndex === index ? stagePrefix + marker : '') + block.text
  })
  return (
    history.prefix +
    parts
      .map((part, i) =>
        i < parts.length - 1 &&
        !part.endsWith('\n') &&
        !(
          history.blocks[i].stage &&
          history.blocks[i].stage?.pipeline ===
            history.blocks[i + 1].stage?.pipeline
        )
          ? part + newline
          : part
      )
      .join('')
  )
}

/** Collect AST names, including captures in functions and references to tags.
 * Keeping relative order for every crossed reference is deliberately conservative:
 * we must never commit a dependency-breaking edit and discover it in the engine.
 */
function namesIn(
  value: unknown,
  references: Set<string>,
  tags: Set<string>
): void {
  if (!value || typeof value !== 'object') return
  if ('type' in value) {
    if (value.type === 'Name' && 'name' in value) {
      const name = value.name
      if (
        name &&
        typeof name === 'object' &&
        'name' in name &&
        typeof name.name === 'string'
      ) {
        references.add(name.name)
      }
      if ('path' in value && isArray(value.path)) {
        for (const segment of value.path) {
          if (
            segment &&
            typeof segment === 'object' &&
            'name' in segment &&
            typeof segment.name === 'string'
          ) {
            references.add(segment.name)
          }
        }
      }
    }
    if (
      value.type === 'TagDeclarator' &&
      'value' in value &&
      typeof value.value === 'string'
    ) {
      tags.add(value.value)
    }
  }
  for (const child of Object.values(value)) {
    if (typeof child === 'object') namesIn(child, references, tags)
  }
}

function bindings(
  block: FeatureBlock,
  wholeStatement = false
): {
  definitions: Set<string>
  references: Set<string>
} {
  const definitions = new Set<string>()
  const references = new Set<string>()
  namesIn(
    !wholeStatement && block.stage ? block.stage.expression : block.statement,
    references,
    definitions
  )
  if (
    (wholeStatement || !block.stage) &&
    block.statement.type === 'VariableDeclaration'
  ) {
    definitions.add(block.statement.declaration.id.name)
  } else if (block.statement.type === 'TypeDeclaration') {
    definitions.add(block.statement.name.name)
  } else if (block.statement.type === 'ImportStatement') {
    const selector = block.statement.selector
    if (selector.type === 'List') {
      for (const item of selector.items)
        definitions.add((item.alias ?? item.name).name)
    } else if (selector.type === 'None' && selector.alias) {
      definitions.add(selector.alias.name)
    }
  }
  return { definitions, references }
}

// Unknown/user-defined stages and type-changing operations are barriers. We
// only reorder stages whose input/output compatibility is known, without
// executing a speculative model or changing the scene to validate a drag.
function stageKind(block: FeatureBlock): string | undefined {
  const expr = block.stage?.expression
  if (expr?.type !== 'CallExpressionKw' || expr.callee.path.length > 0) return
  const name = expr.callee.name.name
  if (
    [
      'fillet',
      'chamfer',
      'translate',
      'rotate',
      'scale',
      'appearance',
      'clone',
    ].includes(name)
  )
    return 'solid'
  if (['abs', 'ceil', 'floor', 'round', 'sqrt'].includes(name)) return 'number'
  if (['line', 'xLine', 'yLine', 'angledLine'].includes(name)) return 'sketch'
}

export function reorderHistoryBlock(
  history: FeatureHistory,
  from: number,
  before: number
): string | Error {
  const source = history.blocks[from]
  if (!source?.movable || before < 0 || before > history.blocks.length) {
    return new Error('This feature cannot be moved here.')
  }
  if (from === before || from + 1 === before) return history.code
  let count = 1
  if (source.stage?.index === 0) {
    while (
      history.blocks[from + count]?.stage?.pipeline === source.stage.pipeline
    )
      count++
    if (before >= from && before <= from + count) return history.code
  }
  const movingStage = source.stage !== undefined && source.stage.index > 0
  const shadowedStage = (block: FeatureBlock) => {
    const expr = block.stage?.expression
    return (
      expr?.type === 'CallExpressionKw' &&
      history.blocks.some(
        (other) =>
          bindings(other, true).definitions.has(expr.callee.name.name) ||
          isGlobImport(other.statement)
      )
    )
  }
  const destination = history.blocks[before]
  if (movingStage) {
    if (shadowedStage(source))
      return new Error(
        'Reorder stages of user-defined functions in the code editor.'
      )
    const previous = history.blocks[before - 1]
    if (
      (destination?.stage?.pipeline !== source.stage?.pipeline &&
        previous?.stage?.pipeline !== source.stage?.pipeline) ||
      (destination?.stage?.pipeline === source.stage?.pipeline &&
        destination?.stage?.index === 0) ||
      (!destination?.stage &&
        previous?.stage?.pipeline !== source.stage?.pipeline)
    )
      return new Error(
        'Pipeline stages must stay after the input of their own pipeline.'
      )
  } else if (destination?.stage && destination.stage.index > 0) {
    return new Error('Move a KCL block before or after the entire pipeline.')
  }
  const crossed = history.blocks
    .slice(Math.min(from, before), before > from ? before : from)
    .filter(
      (block) => !history.blocks.slice(from, from + count).includes(block)
    )
  const sourceNames = bindings(source, !movingStage)
  for (const block of crossed) {
    const otherNames = bindings(block, !movingStage)
    if (
      !block.movable ||
      (movingStage &&
        (!stageKind(source) ||
          stageKind(source) !== stageKind(block) ||
          shadowedStage(block))) ||
      [...sourceNames.definitions].some((name) =>
        otherNames.references.has(name)
      ) ||
      [...otherNames.definitions].some((name) =>
        sourceNames.references.has(name)
      )
    ) {
      return new Error('Cannot move this feature across a dependency.')
    }
  }
  const blocks = [...history.blocks]
  const moved = blocks.splice(from, count)
  blocks.splice(before > from ? before - count : before, 0, ...moved)
  // The bar stays at its current boundary; crossing it changes which blocks run.
  return setHistoryRollback({ ...history, blocks }, history.rollbackIndex)
}
