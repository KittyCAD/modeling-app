import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

/**
 * Whether to move things, or just change them.
 *
 * One answer, resolved once, for everything that animates. Animation is an
 * accessibility question before it is a taste one — motion sickness and
 * vestibular disorders are the reason `prefers-reduced-motion` exists — so the
 * app follows the system unless somebody says otherwise, and every animation
 * asks the same place rather than each one deciding.
 *
 * A signal rather than a boolean read at startup: somebody who turns the
 * preference on because a camera swing made them ill should not have to restart
 * the app to be believed.
 */
export interface MotionService {
  /** True when animation should be skipped and the end state applied at once. */
  readonly reduced: ReadonlySignal<boolean>
}

export const motionContract = defineContract({
  motionService: defineService<MotionService>('motion.service'),
})

export const { motionService } = motionContract
