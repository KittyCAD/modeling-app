import { ChangeSet, Text } from '@codemirror/state'
import type { BodyItem } from '@rust/kcl-lib/bindings/BodyItem'
import type { Expr } from '@rust/kcl-lib/bindings/Expr'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import type {
  ModelingOperation,
  OperationEditTarget,
  TextEdit,
} from '@src/contracts/modelingOperations'
import { byteOffsetToUtf16, sourceRangeToUtf16 } from '@src/lib/kcl/sourceRange'
import { derivedInputs, stdLibCommand } from '@src/lib/kclStdlib/shapes'

/** A root operation that the generic modelling prompt knows how to rewrite. */
export interface EditableFeature {
  operationId: string
  answers: Readonly<Record<string, string>>
  call: { from: number; to: number }
  statement: { from: number; to: number }
  rollbackInsertion: number
  preservedArguments: readonly string[]
}

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

const sourceAt = (source: string, range: SourceRange) => {
  const [from, to] = sourceRangeToUtf16(source, range)
  return source.slice(from, to)
}

/**
 * Describe a directly bound, root-level stdlib call as an editable feature.
 *
 * Pipeline stages and calls inside functions or sketch blocks deliberately do
 * not answer. A root `exit()` cannot stop immediately before those operations
 * without first restructuring their containing expression, so presenting them
 * as editable would promise a rollback position the source cannot represent.
 */
export function editableFeatureFor(
  source: string,
  program: Program,
  runtime: Operation,
  operation: ModelingOperation
): EditableFeature | null {
  if (runtime.type !== 'StdLibCall') {
    return null
  }

  const statement = program.body.find((item) => {
    const expression = expressionOf(item)
    return (
      expression?.type === 'CallExpressionKw' &&
      expression.start === runtime.sourceRange[0] &&
      expression.end === runtime.sourceRange[1]
    )
  })
  if (!statement) {
    return null
  }

  const command = operation.shape ?? stdLibCommand(operation.stdlib)
  if (!command) {
    return null
  }

  const inputs = derivedInputs(command, operation.annotations)
  if (inputs.length === 0) {
    return null
  }
  const answers: Record<string, string> = {}
  const special = inputs.find((input) => input.special)

  if (special && runtime.unlabeledArg) {
    const written = sourceAt(source, runtime.unlabeledArg.sourceRange)
    if (written.trim()) {
      answers[special.name] = written
    }
  }

  for (const input of inputs) {
    if (input.special) {
      continue
    }
    const argument = runtime.labeledArgs[input.name]
    if (!argument) {
      continue
    }
    const written = sourceAt(source, argument.sourceRange)
    if (written.trim()) {
      answers[input.name] = written
    }
  }

  const exposed = new Set(inputs.map((input) => input.name))
  const preservedArguments = Object.entries(runtime.labeledArgs).flatMap(
    ([name, argument]) => {
      if (exposed.has(name)) {
        return []
      }
      const written = sourceAt(source, argument.sourceRange)
      return written.trim() ? [`${name} = ${written}`] : []
    }
  )

  const [callFrom, callTo] = sourceRangeToUtf16(source, runtime.sourceRange)
  const statementFrom = byteOffsetToUtf16(source, statement.start)
  const statementTo = byteOffsetToUtf16(source, statement.end)
  const commentFrom = byteOffsetToUtf16(source, statement.commentStart)
  const boundaryFrom =
    statement.commentStart > 0 && statement.commentStart < statement.start
      ? commentFrom
      : statementFrom

  return {
    operationId: operation.id,
    answers,
    call: { from: callFrom, to: callTo },
    statement: { from: statementFrom, to: statementTo },
    rollbackInsertion: startOfLine(source, boundaryFrom),
    preservedArguments,
  }
}

/** The complete source span of the first standalone root-level `exit()` line. */
export function rollbackExitRange(
  source: string
): { from: number; to: number } | null {
  let from = 0
  let depth = 0

  for (const line of source.split(/(?<=\n)/)) {
    const trimmed = line.trim()
    if (depth === 0 && /^exit\(\)\s*;?$/.test(trimmed)) {
      return { from, to: from + line.length }
    }
    depth += braceDelta(line)
    from += line.length
  }

  return null
}

/**
 * Move the written execution boundary before a feature and map its edit ranges
 * into the resulting document. These edits are suitable for one CodeMirror
 * transaction, so rollback plus enabling the experimental function is one undo.
 */
export function rollbackBeforeFeature(
  source: string,
  feature: EditableFeature
): { changes: readonly TextEdit[]; target: OperationEditTarget } {
  const changes: TextEdit[] = [...experimentalFeatureEdits(source)]
  const existing = rollbackExitRange(source)
  if (existing) {
    changes.push({ ...existing, insert: '' })
  }
  changes.push({
    from: feature.rollbackInsertion,
    to: feature.rollbackInsertion,
    insert: 'exit()\n',
  })

  const ordered = [...changes].sort((a, b) => a.from - b.from || a.to - b.to)
  const changeSet = ChangeSet.of(ordered, source.length)
  const next = changeSet.apply(Text.of(source.split('\n'))).toString()
  const rollback = rollbackExitRange(next)
  if (!rollback) {
    throw new Error('Could not place the rollback boundary.')
  }

  return {
    changes: ordered,
    target: {
      call: {
        from: changeSet.mapPos(feature.call.from, 1),
        to: changeSet.mapPos(feature.call.to, -1),
      },
      statement: {
        from: changeSet.mapPos(feature.statement.from, 1),
        to: changeSet.mapPos(feature.statement.to, -1),
      },
      rollback,
      preservedArguments: feature.preservedArguments,
    },
  }
}

/**
 * Move the written rollback boundary to a root statement, or remove it at the
 * end of the timeline.
 *
 * `insertion` belongs to the current source. Returning edits rather than a new
 * string lets the executing buffer keep this as one undoable transaction.
 */
export function moveRollbackBoundary(
  source: string,
  insertion: number | null
): readonly TextEdit[] {
  const existing = rollbackExitRange(source)
  if (insertion === existing?.from) {
    return []
  }

  const changes: TextEdit[] = []
  if (insertion !== null) {
    changes.push(...experimentalFeatureEdits(source))
  }
  if (existing) {
    changes.push({ ...existing, insert: '' })
  }
  if (insertion !== null) {
    changes.push({ from: insertion, to: insertion, insert: 'exit()\n' })
  }

  return changes.sort((a, b) => a.from - b.from || a.to - b.to)
}

function experimentalFeatureEdits(source: string): readonly TextEdit[] {
  const settings = /@settings\s*\(([\s\S]*?)\)/.exec(source)
  if (!settings || settings.index === undefined) {
    return [
      {
        from: 0,
        to: 0,
        insert: '@settings(experimentalFeatures = allow)\n',
      },
    ]
  }

  const body = settings[1]
  const level = /experimentalFeatures\s*=\s*(allow|warn|deny)/.exec(body)
  if (level && level.index !== undefined) {
    if (level[1] === 'allow') {
      return []
    }
    const valueFrom =
      settings.index +
      settings[0].indexOf(body) +
      level.index +
      level[0].lastIndexOf(level[1])
    return [
      { from: valueFrom, to: valueFrom + level[1].length, insert: 'allow' },
    ]
  }

  const close = settings.index + settings[0].lastIndexOf(')')
  return [
    {
      from: close,
      to: close,
      insert:
        body.trim().length > 0
          ? ', experimentalFeatures = allow'
          : 'experimentalFeatures = allow',
    },
  ]
}

function startOfLine(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
}

function braceDelta(line: string): number {
  let delta = 0
  let quote: string | null = null
  let escaped = false

  for (const character of line) {
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
    } else if (character === '{') {
      delta += 1
    } else if (character === '}') {
      delta -= 1
    }
  }

  return delta
}
