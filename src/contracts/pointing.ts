import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { Provenance } from '@src/lib/kcl/provenance'

/** One thing the user's pointer is over. */
export type PointedAt =
  | { kind: 'entity'; id: string }
  | { kind: 'offset'; offset: number }

/**
 * Which surface the pointer is actually over.
 *
 * Carried because it says **which side already knows**. A hover in the scene has
 * the engine lighting the thing under the cursor before the app hears about it,
 * so the answer worth rendering is the code; a hover in the editor has the
 * caret's own line under the pointer and needs the scene lit. Same query, two
 * different halves left to draw.
 *
 * It is also what lets a surface clear only its own hover. Without it, the mouse
 * leaving the editor would wipe a hover the scene is still showing.
 */
export type PointingOrigin = 'scene' | 'code' | 'outline'

export interface Pointing {
  at: PointedAt
  from: PointingOrigin
}

/**
 * What the pointer is over, and what that has to do with the rest of the app.
 *
 * **One signal, not two kept in step.** Every surface derives its own rendering
 * from this; none of them writes in response to another's read. That is the
 * whole reason a bidirectional highlight is safe to build here at all — the
 * existing app never implemented the code-to-scene direction, and
 * `selectionReveal` says in its own comment that closing the loop "needs an
 * origin to break it". There is no loop to break if nothing writes on read.
 *
 * `provenance` is the answer to the pointing, already worked out: which ranges
 * to decorate, which entities to light, and each one's role. Identity-stable, so
 * a consumer can skip work by comparing — moving the pointer three characters
 * within the same call produces the same object, not an equal one.
 */
export interface PointingService {
  readonly pointing: ReadonlySignal<Pointing | null>
  /** What the program and the scene have to do with what is pointed at. */
  readonly provenance: ReadonlySignal<Provenance | null>
  point(pointing: Pointing): void
  /**
   * Stop pointing, if this surface is the one doing it.
   *
   * Scoped to the origin on purpose: the pointer leaving the editor says nothing
   * about a hover the scene is still showing, and an unscoped clear would have
   * each surface stamping on the other as the mouse crosses between them.
   */
  clear(from: PointingOrigin): void
}

export const pointingContract = defineContract({
  pointingService: defineService<PointingService>('scene.pointing'),
})

export const { pointingService } = pointingContract
