import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

/**
 * The six planes kcl-lib puts on the engine at the start of every run.
 *
 * Named the way the KCL names them, because that is what a user has to type to
 * sketch on one.
 */
export type DefaultPlaneName = 'xy' | 'xz' | 'yz' | 'negXy' | 'negXz' | 'negYz'

/**
 * What somebody has asked of a plane.
 *
 * `auto` is not "shown" or "hidden" with a default — it is a third state, and the
 * distinction is the whole design. A plane on `auto` follows the scene: visible
 * while there is nothing else to look at, gone the moment there is. A plane the
 * user has touched stops following and stays where they put it, until they put
 * it back on `auto`.
 *
 * The existing app has no such state. It mirrors visibility into machine context
 * and mutates it from five separate actions, so the app's idea of what is showing
 * and the engine's can drift, and every new entry point has to remember both.
 */
export type PlaneVisibility = 'auto' | 'shown' | 'hidden'

/** One plane, as something to draw a row for. */
export interface DefaultPlaneView {
  name: DefaultPlaneName
  /** `XY`, `-XZ`. */
  title: string
  /** What the automatic rule and any override work out to, right now. */
  visible: boolean
  /** What the user asked for. */
  visibility: PlaneVisibility
  /**
   * A back face — the same plane seen from behind.
   *
   * Never shown by the automatic rule: three translucent squares orient you and
   * six are a box. They are here to be asked for, which is what the existing app
   * means by `showPlanes(all)`.
   */
  back: boolean
}

/**
 * Whether the default planes are showing, and why.
 *
 * One derived signal and one effect that reconciles the engine to it. That is the
 * whole architecture, and it is a deliberate answer to how this works in the
 * existing app: there, visibility is a flag in machine context kept in step with
 * the engine by hand at each of five call sites, plus a pair of debounced events
 * feeding a nested state machine — with `// This defer is bullshit but playwright
 * wants it` in the source. Two sources of truth kept aligned by discipline.
 */
export interface DefaultPlanesService {
  /** Every plane, in the order a list should show them. */
  readonly planes: ReadonlySignal<readonly DefaultPlaneView[]>
  /**
   * Whether the last run put anything on screen.
   *
   * Exposed because it is the reason the planes are showing, and a panel that
   * cannot say why is a panel people argue with.
   */
  readonly sceneIsEmpty: ReadonlySignal<boolean>
  /** False before anything has run, when there are no planes to address. */
  readonly available: ReadonlySignal<boolean>
  /** Whether anything has been taken off the automatic rule. */
  readonly overridden: ReadonlySignal<boolean>
  set(name: DefaultPlaneName, visibility: PlaneVisibility): void
  /** Put every plane back on the automatic rule. */
  resetOverrides(): void
}

export const defaultPlanesContract = defineContract({
  defaultPlanesService: defineService<DefaultPlanesService>(
    'scene.defaultPlanes'
  ),
})

export const { defaultPlanesService } = defaultPlanesContract
