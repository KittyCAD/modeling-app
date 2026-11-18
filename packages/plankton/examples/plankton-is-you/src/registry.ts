import {
  contract,
  contribute,
  Facet,
  factory,
  type InputOf,
  provide,
  Registry,
  service,
  slot,
} from 'plankton'
import { builtInActions } from './actions'
import { bushPuzzle } from './content'
import { type Action, type Definition, Game, type Puzzle } from './game'
import {
  type OutcomeMeaning,
  type OutcomeProgram,
  type OutcomeRow,
  outcomeMeanings,
  parseOutcomeRows,
  resolveOutcomeVocabulary,
  startingOutcomeRows,
} from './outcomes'

export const gameContract = contract({
  definitions: new Facet(
    'game.definitions',
    (values: readonly Definition[]) => values
  ),
  actions: new Facet('game.actions', (values: readonly Action[]) => values),
  outcomeMeanings: new Facet(
    'game.outcomeMeanings',
    (words: readonly OutcomeMeaning[]) => words
  ),
  outcomeProgram: new Facet(
    'game.outcomeProgram',
    (programs: readonly OutcomeProgram[]): OutcomeProgram => ({
      rows: programs.flatMap((p) => p.rows),
      rules: programs.flatMap((p) => p.rules),
    })
  ),
  session: service<Game>('game.session'),
  puzzles: new Facet('game.puzzles', (values: readonly Puzzle[]) => values),
})
export type PuzzleContribution = InputOf<typeof gameContract.puzzles>
export const starterPuzzles = [
  contribute(gameContract.puzzles, () => bushPuzzle, { key: bushPuzzle.id }),
]
export const compileDefinitions = (
  definitions: readonly Definition[],
  authored = false
) =>
  definitions.map((definition) =>
    contribute(gameContract.definitions, () => definition, {
      key: definition.id,
      precedence: authored ? 'high' : 'default',
    })
  )

/** One session owns the board while slots replace its live vocabulary. */
export async function openGame() {
  const registry = new Registry()
  await registry.configure(starterPuzzles)
  const initialPuzzle = registry.get(gameContract.puzzles)[0]
  if (!initialPuzzle) {
    await registry.dispose()
    throw new Error('At least one starter puzzle is required')
  }
  const startingContent = slot(compileDefinitions(initialPuzzle.definitions))
  const authoredActions = slot([])
  const authoredOutcomeMeanings = slot([])
  const startingProgram = parseOutcomeRows(
    startingOutcomeRows,
    resolveOutcomeVocabulary(initialPuzzle.definitions, outcomeMeanings)
  )
  if (!startingProgram.ok) throw new Error(startingProgram.errors.join('; '))
  const outcomeProgram = slot([
    contribute(gameContract.outcomeProgram, () => startingProgram.program, {
      key: 'editor',
    }),
  ])
  const predicateExtensions = outcomeMeanings.map((word) =>
    contribute(gameContract.outcomeMeanings, () => word, { key: word.id })
  )
  const actions = builtInActions.map((action) =>
    contribute(gameContract.actions, () => action, { key: action.id })
  )
  const session = factory({
    create: (_dependencies, scope) => {
      const definitions = scope.observe(gameContract.definitions)
      const actions = scope.observe(gameContract.actions)
      const words = scope.observe(gameContract.outcomeMeanings)
      const program = scope.observe(gameContract.outcomeProgram)
      const game = new Game(initialPuzzle, {
        definitions: () => definitions.value,
        actions: () => actions.value,
        outcomeMeanings: () => words.value,
        outcomeProgram: () => program.value,
      })
      return {
        exports: game,
        items: [provide(gameContract.session, game)],
        start: () => game.settle(),
      }
    },
  })
  await registry.configure([
    starterPuzzles,
    startingContent,
    actions,
    authoredActions,
    predicateExtensions,
    authoredOutcomeMeanings,
    outcomeProgram,
    session,
  ])
  const board = registry.required(gameContract.session)
  let authored: readonly Definition[] = []
  let customActions: readonly Action[] = []
  let deleted = new Set<string>()
  let customOutcomeMeanings: readonly OutcomeMeaning[] = []
  const vocabulary = (
    definitions: readonly Definition[],
    excluded: ReadonlySet<string>
  ) => [
    compileDefinitions(
      board.puzzle.definitions.filter((d) => !excluded.has(d.id))
    ),
    compileDefinitions(
      definitions.filter((d) => !excluded.has(d.id)),
      true
    ),
  ]
  return {
    game: board,
    registry,
    actions: registry.observe(gameContract.actions),
    outcomeMeanings: registry.observe(gameContract.outcomeMeanings),
    outcomeProgram: registry.observe(gameContract.outcomeProgram),
    definitions: registry.observe(gameContract.definitions),
    puzzles: registry.observe(gameContract.puzzles),
    async publishOutcomeRows(rows: readonly OutcomeRow[]) {
      const parsed = parseOutcomeRows(
        rows,
        resolveOutcomeVocabulary(
          registry.get(gameContract.definitions),
          registry.get(gameContract.outcomeMeanings)
        )
      )
      if (!parsed.ok) throw new Error(parsed.errors.join('; '))
      await registry.replace(outcomeProgram, [
        contribute(gameContract.outcomeProgram, () => parsed.program, {
          key: 'editor',
        }),
      ])
    },
    async publishOutcomeMeaning(word: OutcomeMeaning) {
      const next = [
        ...customOutcomeMeanings.filter((w) => w.id !== word.id),
        word,
      ]
      await registry.replace(
        authoredOutcomeMeanings,
        next.map((w) =>
          contribute(gameContract.outcomeMeanings, () => w, {
            key: w.id,
            precedence: 'high',
          })
        )
      )
      customOutcomeMeanings = next
    },
    async publish(definition: Definition) {
      const next = [
        ...authored.filter((d) => d.id !== definition.id),
        definition,
      ]
      const excluded = new Set(deleted)
      excluded.delete(definition.id)
      await registry.replace(startingContent, vocabulary(next, excluded))
      authored = next
      deleted = excluded
    },
    async deleteDefinition(id: string) {
      if (
        board.board.tiles.some((tile) => tile.type === id) ||
        registry
          .get(gameContract.outcomeProgram)
          .rows.some((row) => row.cells.includes(id))
      )
        throw new Error(
          'Remove placed tiles and applied outcome references before deleting their definition'
        )
      const excluded = new Set(deleted).add(id)
      await registry.replace(startingContent, vocabulary(authored, excluded))
      deleted = excluded
      board.removeDefinitionFromHistory(id)
    },
    async publishAction(action: Action) {
      const next = [...customActions.filter((a) => a.id !== action.id), action]
      await registry.replace(
        authoredActions,
        next.map((a) =>
          contribute(gameContract.actions, () => a, {
            key: a.id,
            precedence: 'high',
          })
        )
      )
      customActions = next
    },
    async loadPuzzle(id: string) {
      const puzzle = registry.get(gameContract.puzzles).find((p) => p.id === id)
      if (!puzzle) throw new Error(`Unknown puzzle: ${id}`)
      await registry.replace(startingContent, [
        compileDefinitions(puzzle.definitions),
        compileDefinitions(authored, true),
      ])
      deleted = new Set()
      board.load(puzzle)
      board.settle()
    },
    dispose: () => registry.dispose(),
  }
}
export type Runtime = Awaited<ReturnType<typeof openGame>>
