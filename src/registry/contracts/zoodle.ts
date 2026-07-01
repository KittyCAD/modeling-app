import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import { TRIM_PREVIEW_LINE_COLOR } from '@src/lib/constants'

export const ZOODLE_BRUSH_SIZE_MIN_PX = 1
export const ZOODLE_BRUSH_SIZE_DEFAULT_PX = 2
export const ZOODLE_BRUSH_SIZE_MAX_PX = 12

export type ZoodleDrawToolDefinition = {
  type: 'draw'
  label: string
  color: string
  colorClassName?: string
  lineWidthMultiplier?: number
}

export type ZoodleEraseToolDefinition = {
  type: 'erase'
  label: string
  lineWidthMultiplier: number
}

export type ZoodleToolDefinition =
  | ZoodleDrawToolDefinition
  | ZoodleEraseToolDefinition

export const zoodleToolDefinitions = {
  drawOrange: {
    type: 'draw',
    label: 'Orange',
    color: TRIM_PREVIEW_LINE_COLOR,
  },
  drawGreen: {
    type: 'draw',
    label: 'Green',
    color: '#29FFA4',
  },
  drawZooBlue: {
    type: 'draw',
    label: 'Zoo blue',
    color: 'currentColor',
    colorClassName: 'text-primary',
  },
  drawDefault: {
    type: 'draw',
    label: 'Default',
    color: 'currentColor',
    colorClassName: 'text-default',
  },
  erase: {
    type: 'erase',
    label: 'Erase',
    lineWidthMultiplier: 4,
  },
} as const satisfies Record<string, ZoodleToolDefinition>

export type ZoodleToolKey = keyof typeof zoodleToolDefinitions

export const defaultZoodleToolKey: ZoodleToolKey = 'drawOrange'

export const zoodleToolKeys = Object.keys(
  zoodleToolDefinitions
) as ZoodleToolKey[]

export interface ZoodleService {
  readonly toolDefinitions: typeof zoodleToolDefinitions
  readonly activeToolKey: ReadonlySignal<ZoodleToolKey>
  readonly brushSize: ReadonlySignal<number>
  equipTool(toolKey: ZoodleToolKey): void
  setBrushSize(brushSize: number): void
}

export const zoodleContract = defineContract({
  zoodleService: defineService<ZoodleService>('zoodle'),
})

export const { zoodleService } = zoodleContract
