import type { Definition, Rule, Tile } from './game'

export type OutcomeContext = {
  entities: readonly Tile[]
  rules: readonly Rule[]
  controlled: readonly Tile[]
  winning: readonly Tile[]
  losing: readonly Tile[]
}
/** Each word contributes its own selection or predicate meaning, not an entire rule. */
export type OutcomeMeaning = { id: string; description: string } & (
  | { kind: 'selector'; select(context: OutcomeContext): readonly Tile[] }
  | {
      kind: 'unary'
      test(subject: readonly Tile[]): boolean
      message(subject: string): string
    }
  | {
      kind: 'relation'
      test(subject: readonly Tile[], target: readonly Tile[]): boolean
      message(subject: string, target: string): string
    }
)
export type OutcomeRow = {
  id: string
  cells: readonly [
    subject: string,
    relation: string,
    target: string,
    result: string,
  ]
}
type Condition =
  | { kind: 'unary'; subject: string; connector: string; predicate: string }
  | { kind: 'relation'; subject: string; predicate: string; target: string }
export type OutcomeRule = {
  id: string
  condition: Condition
  result: 'WIN' | 'LOSE'
}
export type OutcomeProgram = {
  rows: readonly OutcomeRow[]
  rules: readonly OutcomeRule[]
}
export type Resolution =
  | { status: 'playing' | 'won' }
  | { status: 'lost'; message: string; ruleId: string }
export type ParseResult =
  | { ok: true; program: OutcomeProgram }
  | { ok: false; errors: readonly string[] }

export const outcomeMeanings: readonly OutcomeMeaning[] = [
  {
    id: 'YOU',
    kind: 'selector',
    description: 'Entities with player control.',
    select: (context) => context.controlled,
  },
  {
    id: 'WIN',
    kind: 'selector',
    description:
      'Entities with a winning action; after the arrow, declares victory.',
    select: (context) => context.winning,
  },
  {
    id: 'LOSE',
    kind: 'selector',
    description:
      'Entities with a losing action; after the arrow, declares loss.',
    select: (context) => context.losing,
  },
  {
    id: 'NONE',
    kind: 'unary',
    description: 'True when the selected set of entities is empty.',
    test: (subject) => subject.length === 0,
    message: (subject) => `No ${subject} entities remain`,
  },
  {
    id: 'IS',
    kind: 'relation',
    description:
      'True when an entity belongs to both sets. Connects a subject to NONE.',
    test: (subject, target) =>
      subject.some((s) => target.some((t) => t.id === s.id)),
    message: (subject, target) => `${subject} is ${target}`,
  },
  {
    id: 'TOUCH',
    kind: 'relation',
    description: 'True when distinct entities from the two sets share a cell.',
    test: (subject, target) =>
      subject.some((s) =>
        target.some((t) => t.id !== s.id && t.x === s.x && t.y === s.y)
      ),
    message: (subject, target) =>
      subject === 'YOU' && target === 'LOSE'
        ? 'YOU touched a losing entity'
        : `${subject} touches ${target}`,
  },
]
/** Visible vocabulary owns artwork; contributions supply only language meanings. */
export function resolveOutcomeVocabulary(
  definitions: readonly Definition[],
  meanings: readonly OutcomeMeaning[]
): readonly OutcomeMeaning[] {
  return definitions.flatMap((definition): OutcomeMeaning[] => {
    const meaning = meanings.find((word) => word.id === definition.id)
    if (meaning) return [meaning]
    if (definition.kind === 'entity')
      return [
        {
          id: definition.id,
          kind: 'selector',
          description: `All ${definition.id} entities.`,
          select: (context) =>
            context.entities.filter((tile) => tile.type === definition.id),
        },
      ]
    if (definition.kind === 'property')
      return [
        {
          id: definition.id,
          kind: 'selector',
          description: `Entities described as ${definition.id}.`,
          select: (context) =>
            context.entities.filter((tile) =>
              context.rules.some(
                (rule) =>
                  rule.noun === tile.type && rule.property === definition.id
              )
            ),
        },
      ]
    return []
  })
}

export const startingOutcomeRows: readonly OutcomeRow[] = [
  { id: 'no-you', cells: ['YOU', 'IS', 'NONE', 'LOSE'] },
  { id: 'touch-win', cells: ['YOU', 'TOUCH', 'WIN', 'WIN'] },
  { id: 'is-win', cells: ['YOU', 'IS', 'WIN', 'WIN'] },
  { id: 'touch-lose', cells: ['YOU', 'TOUCH', 'LOSE', 'LOSE'] },
]

/** Parse a complete draft before publishing. Missing words never become partial rules. */
export function parseOutcomeRows(
  rows: readonly OutcomeRow[],
  words: readonly OutcomeMeaning[]
): ParseResult {
  const rules: OutcomeRule[] = [],
    errors: string[] = []
  const ids = new Set<string>()
  rows.forEach((row, index) => {
    const [subjectId, relationId, targetId, result] = row.cells
    const subject = words.find((w) => w.id === subjectId),
      relation = words.find((w) => w.id === relationId),
      target = words.find((w) => w.id === targetId)
    const fail = (message: string) =>
      errors.push(`Row ${index + 1}: ${message}`)
    if (ids.has(row.id)) {
      fail('duplicate row identity')
      return
    }
    ids.add(row.id)
    if (subject?.kind !== 'selector') {
      fail('choose a subject selector')
      return
    }
    if (relation?.kind !== 'relation') {
      fail('choose a relation predicate')
      return
    }
    if (
      (result !== 'WIN' && result !== 'LOSE') ||
      words.find((w) => w.id === result)?.kind !== 'selector'
    ) {
      fail('choose WIN or LOSE after the arrow')
      return
    }
    if (target?.kind === 'unary' && relationId === 'IS') {
      rules.push({
        id: row.id,
        condition: {
          kind: 'unary',
          subject: subjectId,
          connector: relationId,
          predicate: targetId,
        },
        result,
      })
    } else if (target?.kind === 'selector') {
      rules.push({
        id: row.id,
        condition: {
          kind: 'relation',
          subject: subjectId,
          predicate: relationId,
          target: targetId,
        },
        result,
      })
    } else {
      fail('choose a selector, or use IS with a unary predicate')
    }
  })
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        program: {
          rows: rows.map((row) => ({ ...row, cells: [...row.cells] })),
          rules,
        },
      }
}

/** Resolve predicate IDs live, so replacing a meaning affects an installed program. */
export function evaluateOutcomes(
  program: OutcomeProgram,
  words: readonly OutcomeMeaning[],
  context: OutcomeContext
): Resolution {
  let won = false
  for (const rule of program.rules) {
    const condition = rule.condition
    const subject = words.find((w) => w.id === condition.subject)
    if (subject?.kind !== 'selector') continue
    const predicate = words.find((w) => w.id === condition.predicate)
    let matches = false,
      message = ''
    if (condition.kind === 'unary' && predicate?.kind === 'unary') {
      if (words.find((w) => w.id === condition.connector)?.kind !== 'relation')
        continue
      matches = predicate.test(subject.select(context))
      message = predicate.message(subject.id)
    } else if (
      condition.kind === 'relation' &&
      predicate?.kind === 'relation'
    ) {
      const target = words.find((w) => w.id === condition.target)
      if (target?.kind !== 'selector') continue
      matches = predicate.test(subject.select(context), target.select(context))
      message = predicate.message(subject.id, target.id)
    }
    if (!matches) continue
    if (rule.result === 'LOSE')
      return { status: 'lost', message, ruleId: rule.id }
    won = true
  }
  return { status: won ? 'won' : 'playing' }
}
