/**
 * Which sketch tool is equipped.
 *
 * All that is left of what used to be a reducer over collected points. The
 * points are gone because the rubber band is not drawn any more — it is a real
 * segment in the sketch, moved by the solver on every pointer event, which is
 * how the existing app does it and the only way a preview can be trusted to be
 * what you will get. What replaced the reducer is `draft.ts`.
 *
 * A union rather than a registry: a tool needs a shape of its own in
 * `draft.ts` — a line takes two clicks, an arc three, a rectangle two and
 * several constraints — so there is nothing for a contributed tool to be until
 * that shape exists.
 */
export type SketchToolId = 'line'
