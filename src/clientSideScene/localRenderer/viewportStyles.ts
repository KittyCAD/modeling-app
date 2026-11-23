import { Color } from 'three'
import {
  abs,
  color,
  dot,
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
  vec3,
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
/** Linear gain that brings the average face brightness to the engine's. */
const PHOSPHOR_GAIN = 1.25

/**
 * Phosphor post-process: geometry shown as an evenly lit CRT aperture grille of
 * magenta, teal and olive columns, with a dim gap between columns and a faintly
 * darker row every few rows. Edges are drawn black, so they stay dark lines.
 */
export function phosphorOutput(sceneColor: Node<'vec4'>) {
  const brightness = dot(sceneColor.rgb, vec3(0.299, 0.587, 0.114))
  const coverage = smoothstep(0.02, 0.1, brightness).mul(PHOSPHOR_GAIN)
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
  return vec4(grille.mul(coverage).mul(gap).mul(row), 1)
}
