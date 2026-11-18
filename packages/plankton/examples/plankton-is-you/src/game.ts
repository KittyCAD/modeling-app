export type Point = { x: number; y: number }
export type Tile = Point & { id: string; kind: 'entity' | 'word'; type: string }
export type Sprite = readonly string[]
export type EntityDefinition = {
  kind: 'entity'
  id: string
  color: string
  sprite: Sprite
  wordSprite?: Sprite
  wordColor?: string
}

/** Properties supply the turn engine with capabilities and optional turn effects. */
export type PropertyDefinition = {
  kind: 'property'
  id: string
  color: string
  wordSprite?: Sprite
  wordColor?: string
  controls?: boolean
  blocks?: boolean
  wins?: boolean
  afterTurn?: (subject: Tile, turn: { destroy: (id: string) => void }) => void
}
export type Definition =
  | EntityDefinition
  | PropertyDefinition
  | { kind: 'grammar'; id: 'IS'; wordSprite?: Sprite; wordColor?: string }

/** A portable starting setup, independent of the live session and its undo history. */
export type Puzzle = {
  id: string
  title: string
  description: string
  bounds: { width: number; height: number }
  definitions: readonly Definition[]
  placements: readonly Tile[]
}
export type Rule = { noun: string; property: string }
export type Board = { tiles: readonly Tile[]; turns: number; won: boolean }
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

/** Board state survives vocabulary replacement; only explicit load/reset replaces it. */
export class Game {
  board: Board
  private history: Board[] = []
  constructor(
    public puzzle: Puzzle,
    private readonly definitions: () => readonly Definition[]
  ) {
    this.board = {
      tiles: puzzle.placements.map((t) => ({ ...t })),
      turns: 0,
      won: false,
    }
  }
  load(puzzle: Puzzle) {
    this.puzzle = puzzle
    this.board = {
      tiles: puzzle.placements.map((t) => ({ ...t })),
      turns: 0,
      won: false,
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
  place(tile: Tile) {
    if (
      !this.inside(tile) ||
      !this.definitions().some((d) => d.id === tile.type)
    )
      return
    this.history.push(this.board)
    this.board = {
      ...this.board,
      won: false,
      tiles: [
        ...this.board.tiles.filter(
          (t) => !(sameCell(t, tile) && t.kind === tile.kind)
        ),
        tile,
      ],
    }
  }
  remove(id: string) {
    if (!this.board.tiles.some((tile) => tile.id === id)) return
    this.history.push(this.board)
    this.board = {
      ...this.board,
      won: false,
      tiles: this.board.tiles.filter((tile) => tile.id !== id),
    }
  }
  step(direction: Point) {
    if (this.board.won) return
    const definitions = this.definitions()
    const rules = readRules(this.board.tiles, definitions)
    const properties = definitions.filter(
      (d): d is PropertyDefinition => d.kind === 'property'
    )
    const has = (tile: Tile, predicate: (p: PropertyDefinition) => boolean) =>
      tile.kind === 'entity' &&
      properties.some(
        (p) =>
          predicate(p) &&
          rules.some((r) => r.noun === tile.type && r.property === p.id)
      )
    let tiles = this.board.tiles.map((t) => ({ ...t }))
    const move = (id: string, visiting = new Set<string>()): boolean => {
      const tile = tiles.find((t) => t.id === id)
      if (!tile || visiting.has(id)) return false
      visiting.add(id)
      const next = { x: tile.x + direction.x, y: tile.y + direction.y }
      if (!this.inside(next)) return false
      const occupants = tiles.filter((t) => sameCell(t, next) && t.id !== id)
      if (occupants.some((t) => has(t, (p) => !!p.blocks))) return false
      for (const occupant of occupants.filter((t) => t.kind === 'word')) {
        if (!move(occupant.id, visiting)) return false
      }
      tile.x = next.x
      tile.y = next.y
      return true
    }
    if (direction.x || direction.y) {
      for (const player of tiles.filter((t) => has(t, (p) => !!p.controls))) {
        const before = tiles.map((t) => ({ ...t }))
        if (!move(player.id)) tiles = before
      }
    }
    // Rules settle after movement. Effects collect removals before publishing a turn.
    const settledRules = readRules(tiles, definitions)
    const destroyed = new Set<string>()
    for (const tile of tiles.filter((t) => t.kind === 'entity')) {
      for (const property of properties) {
        if (
          settledRules.some(
            (r) => r.noun === tile.type && r.property === property.id
          )
        )
          property.afterTurn?.(tile, { destroy: (id) => destroyed.add(id) })
      }
    }
    tiles = tiles.filter((t) => !destroyed.has(t.id))
    const settledHas = (
      tile: Tile,
      predicate: (p: PropertyDefinition) => boolean
    ) =>
      tile.kind === 'entity' &&
      properties.some(
        (p) =>
          predicate(p) &&
          settledRules.some((r) => r.noun === tile.type && r.property === p.id)
      )
    const won = tiles.some(
      (t) =>
        settledHas(t, (p) => !!p.controls) &&
        (settledHas(t, (p) => !!p.wins) ||
          tiles.some(
            (other) =>
              other.id !== t.id &&
              sameCell(t, other) &&
              settledHas(other, (p) => !!p.wins)
          ))
    )
    this.history.push(this.board)
    this.board = { tiles, turns: this.board.turns + 1, won }
  }
}
