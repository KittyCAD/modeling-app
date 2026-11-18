import type { Action, Contact, Point, Tile } from './game'

export type PropertyMatching = {
  actionsFor(tile: Tile): readonly Action[]
  hasProperty(tile: Readonly<Tile>, property: string): boolean
  has(tile: Tile, predicate: (action: Action) => boolean): boolean
}

/** One turn stages movement and contact effects; a failed push restores the whole attempt. */
export class Movement {
  tiles: Tile[]
  constructor(
    tiles: readonly Tile[],
    private readonly inside: (point: Point) => boolean,
    public matching: PropertyMatching
  ) {
    this.tiles = tiles.map((tile) => ({ ...tile }))
  }
  destroy(id: string) {
    this.tiles = this.tiles.filter((tile) => tile.id !== id)
  }
  face(id: string, direction: Point) {
    const tile = this.tiles.find((tile) => tile.id === id)
    if (tile) tile.facing = { ...direction }
  }
  tryMove(id: string, direction: Point): boolean {
    const before = this.tiles.map((tile) => ({ ...tile }))
    const contacted = new Set<string>()
    const moved = new Set<string>()
    const move = (movingId: string, visiting: ReadonlySet<string>): boolean => {
      const moving = this.tiles.find((tile) => tile.id === movingId)
      if (!moving || visiting.has(movingId)) return false
      const nextVisiting = new Set(visiting).add(movingId)
      const next = { x: moving.x + direction.x, y: moving.y + direction.y }
      if (!this.inside(next)) return false
      const atDestination = () =>
        this.tiles.filter(
          (tile) =>
            tile.id !== movingId &&
            !moved.has(tile.id) &&
            tile.x === next.x &&
            tile.y === next.y
        )
      let blocked = false
      for (const other of atDestination()) {
        if (!this.tiles.some((tile) => tile.id === movingId)) break
        if (moving.kind !== 'entity' || other.kind !== 'entity') continue
        const pair = JSON.stringify([movingId, other.id].sort())
        if (contacted.has(pair)) continue
        contacted.add(pair)
        const contact: Contact = {
          moverId: movingId,
          direction,
          hasProperty: (tile, property) =>
            this.matching.hasProperty(tile, property),
          destroy: (target) => this.destroy(target),
          block: () => {
            blocked = true
          },
        }
        for (const [subject, partner] of [
          [moving, other],
          [other, moving],
        ]) {
          for (const action of this.matching.actionsFor(subject)) {
            if (
              !this.tiles.some((tile) => tile.id === subject.id) ||
              !this.tiles.some((tile) => tile.id === partner.id)
            )
              break
            action.onContact?.(subject, partner, contact)
          }
        }
      }
      if (blocked) return false
      // A consumed mover has completed its interaction; its pusher may enter the vacated cell.
      if (!this.tiles.some((tile) => tile.id === movingId)) return true
      const occupants = atDestination()
      if (
        occupants.some(
          (tile) =>
            this.matching.has(tile, (action) => !!action.blocks) &&
            !this.matching.has(tile, (action) => !!action.pushable)
        )
      )
        return false
      for (const occupant of occupants) {
        if (
          occupant.kind !== 'word' &&
          !this.matching.has(occupant, (action) => !!action.pushable)
        )
          continue
        if (
          this.tiles.some((tile) => tile.id === occupant.id) &&
          !move(occupant.id, nextVisiting)
        )
          return false
      }
      const remaining = this.tiles.find((tile) => tile.id === movingId)
      if (remaining) {
        remaining.x = next.x
        remaining.y = next.y
        moved.add(remaining.id)
      }
      return true
    }
    try {
      if (move(id, new Set())) return true
      this.tiles = before
      return false
    } catch (error) {
      this.tiles = before
      throw error
    }
  }
}
