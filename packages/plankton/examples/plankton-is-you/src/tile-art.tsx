import type { Definition, Sprite, Tile } from './game'
import { wordSprite } from './pixels'

export function Pixels({ sprite, color }: { sprite: Sprite; color: string }) {
  const squares = sprite
    .flatMap((row, y) =>
      [...row].flatMap((pixel, x) =>
        pixel === '1' ? [`M${x},${y}h1v1h-1z`] : []
      )
    )
    .join('')
  return (
    <svg
      viewBox={`0 0 ${sprite[0].length} ${sprite.length}`}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d={squares} fill={color} />
    </svg>
  )
}

export const ink = (definition: Definition, kind: Tile['kind']) =>
  kind === 'word' && definition.wordColor
    ? definition.wordColor
    : 'color' in definition
      ? definition.color
      : '#ded9cf'
export const artwork = (definition: Definition, kind: Tile['kind']) =>
  kind === 'entity' && definition.kind === 'entity'
    ? definition.sprite
    : (definition.wordSprite ?? wordSprite(definition.id))
