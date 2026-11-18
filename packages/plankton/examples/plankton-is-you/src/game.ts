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

/** Actions operate through turn capabilities, without owning the board or registry. */
export type Turn = {
  move(id: string, direction: Point): boolean
  face(id: string, direction: Point): void
  destroy(id: string): void
}
export type Action = {
  id: string
  label: string
  description: string
  controls?: boolean
  blocks?: boolean
  wins?: boolean
  afterTurn?: (subject: Readonly<Tile>, turn: Turn) => void
}
export type OutcomeContext = {
  tiles: readonly Tile[]
  controlled: readonly Tile[]
  winning: readonly Tile[]
  rules: readonly Rule[]
}
export type Outcome = {
  id: string
  label: string
  description: string
  evaluate(context: OutcomeContext): 'won' | 'lost' | undefined
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
  status: 'playing' | 'won' | 'lost'
}
export type Vocabulary = {
  definitions(): readonly Definition[]
  actions(): readonly Action[]
  outcomes(): readonly Outcome[]
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
    this.board = this.history.pop() ?? this.board
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
    this.board = { tiles, turns, status: this.evaluate(tiles) }
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
    return {
      rules,
      has: (tile: Tile, predicate: (action: Action) => boolean) =>
        tile.kind === 'entity' &&
        properties.some(
          (p) =>
            rules.some((r) => r.noun === tile.type && r.property === p.id) &&
            actions.some((a) => a.id === p.action && predicate(a))
        ),
    }
  }
  private evaluate(tiles: readonly Tile[]): Board['status'] {
    const { rules, has } = this.matching(
      tiles,
      this.vocabulary.definitions(),
      this.vocabulary.actions()
    )
    const context: OutcomeContext = {
      tiles,
      rules,
      controlled: tiles.filter((t) => has(t, (a) => !!a.controls)),
      winning: tiles.filter((t) => has(t, (a) => !!a.wins)),
    }
    const outcomes = this.vocabulary
      .outcomes()
      .map((outcome) => outcome.evaluate(context))
    if (outcomes.includes('lost')) return 'lost'
    return outcomes.includes('won') ? 'won' : 'playing'
  }
  /** Resume reevaluates rules after paused vocabulary edits without adding a turn. */
  settle() {
    this.board = { ...this.board, status: this.evaluate(this.board.tiles) }
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
    let tiles = this.board.tiles.map((t) => ({ ...t }))
    const { has } = this.matching(tiles, definitions, actions)
    const move = (
      id: string,
      direction: Point,
      visiting = new Set<string>()
    ): boolean => {
      const tile = tiles.find((t) => t.id === id)
      if (!tile || visiting.has(id)) return false
      visiting.add(id)
      const next = { x: tile.x + direction.x, y: tile.y + direction.y }
      if (!this.inside(next)) return false
      const occupants = tiles.filter((t) => sameCell(t, next) && t.id !== id)
      if (occupants.some((t) => has(t, (a) => !!a.blocks))) return false
      for (const occupant of occupants.filter((t) => t.kind === 'word'))
        if (!move(occupant.id, direction, visiting)) return false
      tile.x = next.x
      tile.y = next.y
      return true
    }
    const tryMove = (id: string, direction: Point) => {
      const before = tiles.map((t) => ({ ...t }))
      if (move(id, direction)) return true
      tiles = before
      return false
    }
    if (direction.x || direction.y) {
      for (const player of tiles.filter((t) => has(t, (a) => !!a.controls))) {
        const current = tiles.find((t) => t.id === player.id)!
        current.facing = { ...direction }
        tryMove(player.id, direction)
      }
    }
    const properties = definitions.filter(
      (d): d is PropertyDefinition => d.kind === 'property'
    )
    // Schedule from one post-input snapshot. Each entity/action pair runs once.
    const turnRules = readRules(tiles, definitions)
    const scheduled = tiles
      .filter((t) => t.kind === 'entity')
      .flatMap((subject) =>
        actions
          .filter((action) =>
            properties.some(
              (p) =>
                p.action === action.id &&
                turnRules.some(
                  (r) => r.noun === subject.type && r.property === p.id
                )
            )
          )
          .map((action) => ({ id: subject.id, action }))
      )
    const destroyed = new Set<string>()
    const turn: Turn = {
      move: (id, direction) => !destroyed.has(id) && tryMove(id, direction),
      face: (id, direction) => {
        const tile = tiles.find((t) => t.id === id)
        if (tile) tile.facing = { ...direction }
      },
      destroy: (id) => {
        destroyed.add(id)
        tiles = tiles.filter((t) => t.id !== id)
      },
    }
    for (const { id, action } of scheduled) {
      const subject = tiles.find((t) => t.id === id)
      if (subject) action.afterTurn?.(subject, turn)
    }
    this.commit(tiles, this.board.turns + 1)
  }
}
