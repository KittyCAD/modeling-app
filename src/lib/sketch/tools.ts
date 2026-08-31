/**
 * Which sketch tool is equipped.
 *
 * A union rather than a registry, because a tool needs a shape of its own in
 * `draft.ts` — a line takes two clicks, an arc three, a rectangle two and eight
 * constraints — so there is nothing for a contributed tool to *be* until that
 * shape exists. Which is the real difference between a sketch tool and a
 * modelling one: a modelling tool is derived from a stdlib signature, and a
 * sketch tool is a pointer state machine with no signature to derive from.
 *
 * What the tool is *called*, which letter equips it and where its button sits are
 * not here. That is presentation, it needs to name a toolbar mode, and it belongs
 * with the other toolbar catalogues — see `features/sketchOverlay/catalog.ts`.
 */
export type SketchToolId =
  | 'line'
  | 'point'
  | 'circle'
  | 'threePointArc'
  | 'cornerRectangle'
  | 'centerRectangle'

/** Every tool there is, for the catalogue to place and for tests to check. */
export const SKETCH_TOOL_IDS: readonly SketchToolId[] = [
  'line',
  'point',
  'circle',
  'threePointArc',
  'cornerRectangle',
  'centerRectangle',
]
