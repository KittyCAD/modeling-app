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
import { bushPuzzle } from './content'
import { type Definition, Game, type Puzzle } from './game'

export const gameContract = contract({
  definitions: new Facet(
    'game.definitions',
    (values: readonly Definition[]) => values
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
  const authoredContent = slot([])
  const session = factory({
    create: (_dependencies, scope) => {
      const definitions = scope.observe(gameContract.definitions)
      const game = new Game(initialPuzzle, () => definitions.value)
      return { exports: game, items: [provide(gameContract.session, game)] }
    },
  })
  await registry.configure([
    starterPuzzles,
    startingContent,
    authoredContent,
    session,
  ])
  const board = registry.required(gameContract.session)
  let authored: readonly Definition[] = []
  return {
    game: board,
    registry,
    definitions: registry.observe(gameContract.definitions),
    puzzles: registry.observe(gameContract.puzzles),
    async publish(definition: Definition) {
      const next = [
        ...authored.filter((d) => d.id !== definition.id),
        definition,
      ]
      await registry.replace(authoredContent, compileDefinitions(next, true))
      authored = next
    },
    async loadPuzzle(id: string) {
      const puzzle = registry.get(gameContract.puzzles).find((p) => p.id === id)
      if (!puzzle) throw new Error(`Unknown puzzle: ${id}`)
      await registry.replace(
        startingContent,
        compileDefinitions(puzzle.definitions)
      )
      board.load(puzzle)
    },
    dispose: () => registry.dispose(),
  }
}
export type Runtime = Awaited<ReturnType<typeof openGame>>
