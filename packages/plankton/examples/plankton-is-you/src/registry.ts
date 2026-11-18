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
import { builtInActions, builtInOutcomes } from './actions'
import { bushPuzzle } from './content'
import {
  type Action,
  type Definition,
  Game,
  type Outcome,
  type Puzzle,
} from './game'

export const gameContract = contract({
  definitions: new Facet(
    'game.definitions',
    (values: readonly Definition[]) => values
  ),
  actions: new Facet('game.actions', (values: readonly Action[]) => values),
  outcomes: new Facet('game.outcomes', (values: readonly Outcome[]) => values),
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
  const actions = builtInActions.map((action) =>
    contribute(gameContract.actions, () => action, { key: action.id })
  )
  const outcomes = builtInOutcomes.map((outcome) =>
    contribute(gameContract.outcomes, () => outcome, { key: outcome.id })
  )
  const session = factory({
    create: (_dependencies, scope) => {
      const definitions = scope.observe(gameContract.definitions)
      const actions = scope.observe(gameContract.actions)
      const outcomes = scope.observe(gameContract.outcomes)
      const game = new Game(initialPuzzle, {
        definitions: () => definitions.value,
        actions: () => actions.value,
        outcomes: () => outcomes.value,
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
    outcomes,
    authoredActions,
    session,
  ])
  const board = registry.required(gameContract.session)
  let authored: readonly Definition[] = []
  let customActions: readonly Action[] = []
  let deleted = new Set<string>()
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
    outcomes: registry.observe(gameContract.outcomes),
    definitions: registry.observe(gameContract.definitions),
    puzzles: registry.observe(gameContract.puzzles),
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
      if (board.board.tiles.some((tile) => tile.type === id))
        throw new Error('Remove placed tiles before deleting their definition')
      const excluded = new Set(deleted).add(id)
      await registry.replace(startingContent, vocabulary(authored, excluded))
      deleted = excluded
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
