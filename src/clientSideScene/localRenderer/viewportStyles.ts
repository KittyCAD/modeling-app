import { Color } from 'three'
import {
  abs,
  color,
  diffuseColor,
  float,
  floor,
  fract,
  fwidth,
  max,
  mix,
  mod,
  normalWorld,
  output,
  positionWorld,
  screenCoordinate,
  select,
  smoothstep,
  step,
  vec4,
} from 'three/tsl'
import type { Node, UniformNode } from 'three/webgpu'

// Colors matched to the engine's streamed Retro CAD style.
const RETRO_CAD_VERTICAL_LINE = new Color(0x3cf0b0)
const RETRO_CAD_HORIZONTAL_LINE = new Color(0x5a68e0)
export const RETRO_CAD_EDGE_COLOR = new Color(0xd2fff0)
export const PHOSPHOR_EDGE_COLOR = new Color(0x000000)
const PHOSPHOR_MAGENTA = new Color(0x82487d)
const PHOSPHOR_TEAL = new Color(0x5f9187)
const PHOSPHOR_OLIVE = new Color(0x7a8a55)

/** Anti-aliased grid line strength for a coordinate in grid cells, about one pixel wide. */
function gridLine(cells: Node<'float'>) {
  const distance = abs(fract(cells.sub(0.5)).sub(0.5))
  const width = fwidth(cells)
  return float(1).sub(smoothstep(width.mul(0.5), width.mul(1.5), distance))
}

/**
 * The material output for Retro CAD: black faces with a grid fixed to the model.
 * The renderer's world is glTF Y-up, so lines of constant Y run horizontally and the rest vertically.
 * A face skips the lines of its own normal axis, which would cover it entirely.
 */
export function retroCadOutput(
  amount: UniformNode<'float', number>,
  spacing: UniformNode<'float', number>
) {
  const cells = positionWorld.div(spacing)
  const facing = abs(normalWorld)
  const skipFacing = (axis: Node<'float'>) => step(axis, float(0.9))
  const vertical = max(
    gridLine(cells.x).mul(skipFacing(facing.x)),
    gridLine(cells.z).mul(skipFacing(facing.z))
  )
  const horizontal = gridLine(cells.y).mul(skipFacing(facing.y))
  const lines = mix(
    color(RETRO_CAD_VERTICAL_LINE).mul(vertical),
    color(RETRO_CAD_HORIZONTAL_LINE),
    horizontal
  )
  return mix(output, vec4(lines, 1), amount)
}

/** Width in device pixels of one phosphor column; the grille repeats every three. */
const PHOSPHOR_COLUMN_WIDTH = 3
/** Every this many rows of device pixels, one row is drawn dimmer. */
const PHOSPHOR_ROW_PERIOD = 6
/**
 * Linear gain for the grille, so a face in the default (near white) model colour
 * comes out at about the streamed brightness, which averages 104/255.
 */
const PHOSPHOR_GAIN = 1.2

/**
 * The material output for Phosphor: each face's own colour, unlit, as the
 * engine shows it. Without Phosphor, `base` passes through unchanged.
 */
export function phosphorMaterialOutput(
  amount: UniformNode<'float', number>,
  base: Node<'vec4'>
) {
  return mix(base, vec4(diffuseColor.rgb, 1), amount)
}

/**
 * Phosphor post-process: the scene seen through a CRT aperture grille of
 * magenta, teal and olive columns, with a dim gap between columns and a
 * faintly darker row every few rows. It keeps each face's colour, and black
 * edges and background stay black.
 */
export function phosphorOutput(sceneColor: Node<'vec4'>) {
  const columnPosition = screenCoordinate.x.div(PHOSPHOR_COLUMN_WIDTH)
  const column = mod(floor(columnPosition), 3)
  const grille = select(
    column.lessThan(1),
    color(PHOSPHOR_MAGENTA),
    select(column.lessThan(2), color(PHOSPHOR_TEAL), color(PHOSPHOR_OLIVE))
  )
  const gap = mix(float(1), float(0.7), step(0.8, fract(columnPosition)))
  const row = select(
    mod(floor(screenCoordinate.y), PHOSPHOR_ROW_PERIOD).lessThan(1),
    float(0.85),
    float(1)
  )
  return vec4(
    sceneColor.rgb.mul(grille).mul(PHOSPHOR_GAIN).mul(gap).mul(row),
    1
  )
}
