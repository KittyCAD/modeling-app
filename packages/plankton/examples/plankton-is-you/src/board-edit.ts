import type { Point, Tile } from './game'

export type Brush = Pick<Tile, 'kind' | 'type'>

/** Paint immutable draft tiles, filling skipped cells between pointer samples. Null erases. */
export function paintBoard(
  tiles: readonly Tile[],
  from: Point,
  to: Point,
  brush: Brush | null
): readonly Tile[] {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  for (let step = 0; step <= steps; step++) {
    const ratio = steps ? step / steps : 0
    const x = Math.round(from.x + (to.x - from.x) * ratio)
    const y = Math.round(from.y + (to.y - from.y) * ratio)
    const occupants = tiles.filter((tile) => tile.x === x && tile.y === y)
    if (!brush && !occupants.length) continue
    if (
      brush &&
      occupants.length === 1 &&
      occupants[0].kind === brush.kind &&
      occupants[0].type === brush.type
    )
      continue
    tiles = tiles.filter((tile) => tile.x !== x || tile.y !== y)
    if (brush) tiles = [...tiles, { ...brush, x, y, id: crypto.randomUUID() }]
  }
  return tiles
}
