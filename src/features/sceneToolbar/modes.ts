import type { SceneMode } from '@src/contracts/sceneModes'

/**
 * The three modes the app ships with.
 *
 * Data, not code, because none of them does anything: a mode names a way of
 * working and the keymap scope that is live inside it. Which tools appear is
 * contributed separately, by whoever owns them — the modelling operations fill
 * two of these, and Sketching is deliberately empty until sketch V2 tooling
 * exists.
 *
 * Shipped by this feature rather than contributed by three others because they
 * are the vocabulary, not extensions of it. The value spec is still the way in:
 * a plugin adding a Simulation mode contributes one of these and needs nothing
 * from this file.
 */

export const MODELING_MODE = 'modeling'
export const SKETCHING_MODE = 'sketching'
export const ANNOTATING_MODE = 'annotating'

/** Applied to the keymap while the matching mode is active. */
export const MODELING_SCOPE = 'mode.modeling'
export const SKETCHING_SCOPE = 'mode.sketching'
export const ANNOTATING_SCOPE = 'mode.annotating'

export const builtInModes: readonly SceneMode[] = [
  {
    id: MODELING_MODE,
    title: 'Model',
    icon: 'model',
    order: 10,
    keymapScope: MODELING_SCOPE,
    empty: 'No modelling tools are installed.',
  },
  {
    id: SKETCHING_MODE,
    title: 'Sketch',
    icon: 'sketch',
    order: 20,
    keymapScope: SKETCHING_SCOPE,
    /*
     * Reachable only from inside a sketch, which is gated elsewhere.
     *
     * The mode is declared here because it is part of the vocabulary; *when* it
     * applies is a fact about the KCL file, contributed by the feature that knows
     * what a sketch is. This file would otherwise have to learn.
     */
    empty: 'Sketch tools are not built yet — sketch V2 edits inside a block.',
  },
  {
    id: ANNOTATING_MODE,
    title: 'Annotate',
    icon: 'dimension',
    order: 30,
    keymapScope: ANNOTATING_SCOPE,
    empty: 'No annotation tools are installed.',
  },
]

/**
 * The keymap scope a mode makes live.
 *
 * Exported so a feature contributing a *binding* to a mode does not have to
 * hardcode the scope name next to the mode name and keep the two in step.
 */
export const scopeForMode = (modeId: string): string | undefined =>
  builtInModes.find((mode) => mode.id === modeId)?.keymapScope
