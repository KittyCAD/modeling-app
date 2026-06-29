import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import { TRIM_PREVIEW_LINE_COLOR } from '@src/lib/constants'

export type ZoodleDrawToolDefinition = {
  type: 'draw'
  label: string
  color: string
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
  drawWhite: {
    type: 'draw',
    label: 'White',
    color: '#FFFFFF',
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
  equipTool(toolKey: ZoodleToolKey): void
}

export const zoodleContract = defineContract({
  zoodleService: defineService<ZoodleService>('zoodle'),
})

export const { zoodleService } = zoodleContract
