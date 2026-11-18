import { Movement } from './movement'
import {
  evaluateOutcomes,
  type OutcomeMeaning,
  type OutcomeProgram,
  type Resolution,
  resolveOutcomeVocabulary,
} from './outcomes'

export type Point = { x: number; y: number }
export type Tile = Point & {
  id: string
  kind: 'entity' | 'word'
  type: string
  facing?: Point
}
export type Sprite = readonly string[]
export type EntityDefinition = {
  kind: 'entity'
  id: string
  color: string
  sprite: Sprite
  wordSprite?: Sprite
  wordColor?: string
}

/** A property names a contributed action; its artwork does not determine behavior. */
export type PropertyDefinition = {
  kind: 'property'
  id: string
  color: string
  wordSprite?: Sprite
  wordColor?: string
  action: string
}
export type Definition =
  | EntityDefinition
  | PropertyDefinition
  | { kind: 'grammar'; id: 'IS'; wordSprite?: Sprite; wordColor?: string }
  | {
      kind: 'word'
      id: string
      color: string
      wordSprite?: Sprite
      wordColor?: string
    }

/** Actions operate through turn capabilities, without owning the board or registry. */
export type Turn = {
  move(id: string, direction: Point): boolean
  face(id: string, direction: Point): void
  destroy(id: string): void
  hasProperty(tile: Readonly<Tile>, property: string): boolean
}
/** Contact runs for either participant before blocking or pushing is resolved. */
export type Contact = {
  moverId: string
  direction: Readonly<Point>
  hasProperty(tile: Readonly<Tile>, property: string): boolean
  destroy(id: string): void
  block(): void
}
export type Action = {
  id: string
  label: string
  description: string
  controls?: boolean
  blocks?: boolean
  pushable?: boolean
  wins?: boolean
  loses?: boolean
  onContact?: (
    subject: Readonly<Tile>,
    other: Readonly<Tile>,
    contact: Contact
  ) => void
  afterTurn?: (subject: Readonly<Tile>, turn: Turn) => void
}
/** A starting setup specifies bounds, installed definitions, and tile instances. */
export type Puzzle = {
  id: string
  title: string
  description: string
  bounds: { width: number; height: number }
  definitions: readonly Definition[]
  placements: readonly Tile[]
}
export type Rule = { noun: string; property: string }
export type Board = {
  tiles: readonly Tile[]
  turns: number
} & Resolution
export type Vocabulary = {
  definitions(): readonly Definition[]
  actions(): readonly Action[]
  outcomeMeanings(): readonly OutcomeMeaning[]
  outcomeProgram(): OutcomeProgram
}
const sameCell = (a: Point, b: Point) => a.x === b.x && a.y === b.y

export function readRules(
  tiles: readonly Tile[],
  definitions: readonly Definition[]
): Rule[] {
  const nouns = new Set(
    definitions.filter((d) => d.kind === 'entity').map((d) => d.id)
  )
  const properties = new Set(
    definitions.filter((d) => d.kind === 'property').map((d) => d.id)
  )
  if (!definitions.some((d) => d.kind === 'grammar' && d.id === 'IS')) return []
  const rules: Rule[] = []
  const wordAt = (x: number, y: number, type: string) =>
    tiles.some(
      (t) => t.kind === 'word' && t.x === x && t.y === y && t.type === type
    )
  for (const tile of tiles) {
    if (tile.kind !== 'word' || !nouns.has(tile.type)) continue
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      if (!wordAt(tile.x + dx, tile.y + dy, 'IS')) continue
      for (const property of properties) {
        if (wordAt(tile.x + dx * 2, tile.y + dy * 2, property))
          rules.push({ noun: tile.type, property })
      }
    }
  }
  return rules
}

/** Vocabulary changes never replace the session or its board history. */
export class Game {
  board: Board
  private history: Board[] = []
  constructor(
    public puzzle: Puzzle,
    private readonly vocabulary: Vocabulary
  ) {
    this.board = {
      tiles: puzzle.placements.map((t) => ({ ...t })),
      turns: 0,
      status: 'playing',
    }
  }
  load(puzzle: Puzzle) {
    this.puzzle = puzzle
    this.board = {
      tiles: puzzle.placements.map((t) => ({ ...t })),
      turns: 0,
      status: 'playing',
    }
    this.history = []
  }
  undo() {
    const previous = this.history.pop()
    if (previous)
      this.board = {
        tiles: previous.tiles,
        turns: previous.turns,
        ...this.evaluate(previous.tiles),
      }
  }
  removeDefinitionFromHistory(id: string) {
    this.history = this.history.map((board) => ({
      ...board,
      tiles: board.tiles.filter((tile) => tile.type !== id),
    }))
  }
  inside(point: Point) {
    return (
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < this.puzzle.bounds.width &&
      point.y < this.puzzle.bounds.height
    )
  }
  private commit(tiles: readonly Tile[], turns = this.board.turns) {
    this.history.push(this.board)
    this.board = { tiles, turns, ...this.evaluate(tiles) }
  }
  private matching(
    tiles: readonly Tile[],
    definitions: readonly Definition[],
    actions: readonly Action[]
  ) {
    const rules = readRules(tiles, definitions)
    const properties = definitions.filter(
      (d): d is PropertyDefinition => d.kind === 'property'
    )
    const hasProperty = (tile: Readonly<Tile>, property: string) =>
      tile.kind === 'entity' &&
      rules.some(
        (rule) => rule.noun === tile.type && rule.property === property
      )
    const actionsFor = (tile: Tile) =>
      tile.kind !== 'entity'
        ? []
        : actions.filter((action) =>
            properties.some(
              (property) =>
                property.action === action.id && hasProperty(tile, property.id)
            )
          )
    return {
      rules,
      actionsFor,
      hasProperty,
      has: (tile: Tile, predicate: (action: Action) => boolean) =>
        actionsFor(tile).some(predicate),
    }
  }

  private evaluate(tiles: readonly Tile[]): Resolution {
    const { rules, has } = this.matching(
      tiles,
      this.vocabulary.definitions(),
      this.vocabulary.actions()
    )
    return evaluateOutcomes(
      this.vocabulary.outcomeProgram(),
      resolveOutcomeVocabulary(
        this.vocabulary.definitions(),
        this.vocabulary.outcomeMeanings()
      ),
      {
        entities: tiles.filter((tile) => tile.kind === 'entity'),
        rules,
        controlled: tiles.filter((tile) =>
          has(tile, (action) => !!action.controls)
        ),
        winning: tiles.filter((tile) => has(tile, (action) => !!action.wins)),
        losing: tiles.filter((tile) => has(tile, (action) => !!action.loses)),
      }
    )
  }
  /** Resume reevaluates rules after paused vocabulary edits without adding a turn. */
  settle() {
    this.board = {
      tiles: this.board.tiles,
      turns: this.board.turns,
      ...this.evaluate(this.board.tiles),
    }
  }
  place(tile: Tile) {
    if (
      !this.inside(tile) ||
      !this.vocabulary.definitions().some((d) => d.id === tile.type)
    )
      return
    this.commit([
      ...this.board.tiles.filter(
        (t) => !(sameCell(t, tile) && t.kind === tile.kind)
      ),
      tile,
    ])
  }
  remove(id: string) {
    if (!this.board.tiles.some((tile) => tile.id === id)) return
    this.commit(this.board.tiles.filter((tile) => tile.id !== id))
  }
  step(direction: Point) {
    if (this.board.status !== 'playing') return
    const definitions = this.vocabulary.definitions(),
      actions = this.vocabulary.actions()
    const initial = this.matching(this.board.tiles, definitions, actions)
    const movement = new Movement(
      this.board.tiles,
      (point) => this.inside(point),
      initial
    )
    if (direction.x || direction.y) {
      for (const player of movement.tiles.filter((tile) =>
        initial.has(tile, (action) => !!action.controls)
      )) {
        if (!movement.tiles.some((tile) => tile.id === player.id)) continue
        movement.face(player.id, direction)
        movement.tryMove(player.id, direction)
      }
    }
    // Schedule from one post-input snapshot. Each entity/action pair runs once.
    const afterInput = this.matching(movement.tiles, definitions, actions)
    movement.matching = afterInput
    const scheduled = movement.tiles.flatMap((subject) =>
      afterInput
        .actionsFor(subject)
        .map((action) => ({ id: subject.id, action }))
    )
    const turn: Turn = {
      move: (id, direction) => movement.tryMove(id, direction),
      face: (id, direction) => movement.face(id, direction),
      destroy: (id) => movement.destroy(id),
      hasProperty: (tile, property) => afterInput.hasProperty(tile, property),
    }
    for (const { id, action } of scheduled) {
      const subject = movement.tiles.find((tile) => tile.id === id)
      if (subject) action.afterTurn?.(subject, turn)
    }
    this.commit(movement.tiles, this.board.turns + 1)
  }
}
