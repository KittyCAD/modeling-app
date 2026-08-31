import type { IconName } from '@kittycad/ui-kit'

/**
 * Which sketch tool is equipped, and what each one is called.
 *
 * A union rather than a registry: a tool needs a shape of its own in
 * `draft.ts` — a line takes two clicks, an arc three, a rectangle two and
 * several constraints — so there is nothing for a contributed tool to be until
 * that shape exists. The table below is presentation only; the behaviour is in
 * the draft model.
 *
 * Names, icons and keys are the existing app's. Somebody switching between the
 * two should not have to relearn which letter draws a circle.
 */
export type SketchToolId = 'line' | 'point' | 'circle'

export interface SketchToolInfo {
  id: SketchToolId
  title: string
  icon: IconName
  description: string
  /** The single letter that equips it, as the existing app binds them. */
  key: string
  /**
   * Where it sits in the toolbar, in tens.
   *
   * Gaps rather than consecutive numbers, so a tool can be slotted between two
   * others without renumbering the rest.
   */
  order: number
}

export const SKETCH_TOOLS: readonly SketchToolInfo[] = [
  {
    id: 'line',
    title: 'Line',
    icon: 'line',
    description: 'Draw a line between two points, then keep going.',
    key: 'l',
    order: 10,
  },
  {
    id: 'point',
    title: 'Point',
    icon: 'oneDot',
    description: 'Place a single point in the sketch.',
    key: '.',
    order: 20,
  },
  {
    id: 'circle',
    title: 'Center circle',
    icon: 'circle',
    description: 'Draw a circle from its centre and a point on it.',
    key: 'c',
    order: 30,
  },
]

export const sketchToolInfo = (id: SketchToolId): SketchToolInfo =>
  SKETCH_TOOLS.find((tool) => tool.id === id) as SketchToolInfo
