import type { Definition, Rule, Tile } from './game'

export type OutcomeContext = {
  tiles: readonly Tile[]
  entities: readonly Tile[]
  rules: readonly Rule[]
  controlled: readonly Tile[]
  winning: readonly Tile[]
  losing: readonly Tile[]
}
/** Each word contributes its own selection or predicate meaning, not an entire rule. */
export type OutcomeMeaning = { id: string; description: string } & (
  | {
      kind: 'selector' | 'word-selector'
      select(context: OutcomeContext): readonly Tile[]
    }
  | {
      kind: 'unary'
      test(subject: readonly Tile[]): boolean
      message(subject: string, selection: 'selector' | 'word-selector'): string
    }
  | {
      kind: 'relation'
      test(subject: readonly Tile[], target: readonly Tile[]): boolean
      message(subject: string, target: string): string
    }
)
/** Only subject (0) and target (2) cells can explicitly select physical words. */
export type OutcomeRow = {
  id: string
  wordTiles?: readonly (0 | 2)[]
  cells: readonly [
    subject: string,
    relation: string,
    target: string,
    result: string,
  ]
}
type Selection = { id: string; kind: 'selector' | 'word-selector' }
type Condition =
  | { kind: 'unary'; subject: Selection; connector: string; predicate: string }
  | {
      kind: 'relation'
      subject: Selection
      predicate: string
      target: Selection
    }
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
    description: 'True when the selected set of tiles is empty.',
    test: (subject) => subject.length === 0,
    message: (subject, selection) =>
      `No ${subject} ${selection === 'word-selector' ? 'word tiles' : 'entities'} remain`,
  },
  {
    id: 'IS',
    kind: 'relation',
    description:
      'True when a selected tile belongs to both sets. Connects a subject to NONE.',
    test: (subject, target) =>
      subject.some((s) => target.some((t) => t.id === s.id)),
    message: (subject, target) => `${subject} is ${target}`,
  },
  {
    id: 'TOUCH',
    kind: 'relation',
    description: 'True when distinct selected tiles share a cell.',
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
/** A word's physical tiles can be selected independently of its language meaning. */
export const wordTileSelector = (id: string): OutcomeMeaning => ({
  id,
  kind: 'word-selector',
  description: `All ${id} word tiles.`,
  select: (context) =>
    context.tiles.filter((tile) => tile.kind === 'word' && tile.type === id),
})
export const outcomeMeaningKey = (meaning: OutcomeMeaning) =>
  `${meaning.kind}:${meaning.id}`

/** Visible vocabulary owns artwork; contributions supply only language meanings. */
export function resolveOutcomeVocabulary(
  definitions: readonly Definition[],
  meanings: readonly OutcomeMeaning[]
): readonly OutcomeMeaning[] {
  return definitions.flatMap((definition): OutcomeMeaning[] => {
    const contributed = meanings.filter((word) => word.id === definition.id)
    if (contributed.some((word) => word.kind === 'selector')) return contributed
    if (definition.kind === 'entity')
      return [
        ...contributed,
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
        ...contributed,
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
    return contributed
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
    const selection = (id: string, index: 0 | 2) => {
      const meaning =
        (!row.wordTiles?.includes(index) &&
          words.find((word) => word.id === id && word.kind === 'selector')) ||
        words.find((word) => word.id === id && word.kind === 'word-selector')
      return meaning &&
        (meaning.kind === 'selector' || meaning.kind === 'word-selector')
        ? { id, kind: meaning.kind }
        : undefined
    }
    const subject = selection(subjectId, 0)
    const relation = words.find(
      (word) => word.id === relationId && word.kind === 'relation'
    )
    const target = selection(targetId, 2)
    const unary =
      !row.wordTiles?.includes(2) &&
      words.find((word) => word.id === targetId && word.kind === 'unary')
    const fail = (message: string) =>
      errors.push(`Row ${index + 1}: ${message}`)
    if (ids.has(row.id)) {
      fail('duplicate row identity')
      return
    }
    ids.add(row.id)
    if (!subject) {
      fail('choose a subject selector')
      return
    }
    if (relation?.kind !== 'relation') {
      fail('choose a relation predicate')
      return
    }
    if (
      (result !== 'WIN' && result !== 'LOSE') ||
      !words.some((word) => word.id === result && word.kind === 'selector')
    ) {
      fail('choose WIN or LOSE after the arrow')
      return
    }
    if (unary && relationId === 'IS') {
      rules.push({
        id: row.id,
        condition: {
          kind: 'unary',
          subject,
          connector: relationId,
          predicate: targetId,
        },
        result,
      })
    } else if (target) {
      rules.push({
        id: row.id,
        condition: {
          kind: 'relation',
          subject,
          predicate: relationId,
          target,
        },
        result,
      })
    } else {
      fail('choose a selectable tile, or use IS with a unary predicate')
    }
  })
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        program: {
          rows: rows.map((row) => ({
            ...row,
            cells: [...row.cells],
            wordTiles: row.wordTiles ? [...row.wordTiles] : undefined,
          })),
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
    const select = (reference: Selection) =>
      words.find(
        (word) => word.id === reference.id && word.kind === reference.kind
      )
    const subject = select(condition.subject)
    if (
      !subject ||
      (subject.kind !== 'selector' && subject.kind !== 'word-selector')
    )
      continue
    const predicate = words.find(
      (word) => word.id === condition.predicate && word.kind === condition.kind
    )
    let matches = false,
      message = ''
    if (condition.kind === 'unary' && predicate?.kind === 'unary') {
      if (
        !words.some(
          (word) => word.id === condition.connector && word.kind === 'relation'
        )
      )
        continue
      matches = predicate.test(subject.select(context))
      message = predicate.message(subject.id, subject.kind)
    } else if (
      condition.kind === 'relation' &&
      predicate?.kind === 'relation'
    ) {
      const target = select(condition.target)
      if (
        !target ||
        (target.kind !== 'selector' && target.kind !== 'word-selector')
      )
        continue
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
