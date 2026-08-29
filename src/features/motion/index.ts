import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { motionService } from '@src/contracts/motion'
import { settingsService, settingsValueSpec } from '@src/contracts/settings'
import {
  limitAnimationSetting,
  motionSettings,
} from '@src/features/motion/settings'

/**
 * Whether the app should animate.
 *
 * The same arrangement as the theme, one layer smaller: the choice lives in the
 * settings cascade, the browser's own preference is the default, and this turns
 * the two into a single signal that everything which moves can read.
 *
 * Deliberately its own feature rather than a field on the camera. The camera is
 * the first thing to animate and will not be the last — a dialog, a panel, a
 * sheet — and each of them working out its own answer is how an app ends up
 * respecting the preference in three places out of five.
 */
export default defineRegistryItemFactory((ctx) => {
  /**
   * The browser's answer, watched rather than sampled.
   *
   * Somebody who turns reduced motion on because the camera made them ill
   * should not have to restart the app to be believed.
   */
  const query =
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null

  const systemReduced = signal(query?.matches ?? false)
  const onChange = (event: MediaQueryListEvent) => {
    systemReduced.value = event.matches
  }
  query?.addEventListener('change', onChange)

  /**
   * Resolved optionally, and erring towards *allowing* motion.
   *
   * A build with no settings service yet is not a request for a still app; the
   * system query is the honest default and it is already the right answer for
   * anybody who set it.
   */
  const reduced = computed(() => {
    const choice = ctx.services
      .optional(settingsService)
      ?.value(limitAnimationSetting).value

    if (choice === 'on') return true
    if (choice === 'off') return false
    return systemReduced.value
  })

  return {
    model: { reduced },
    item: defineRuntimeRegistryItem({
      id: 'motion',
      providesServices: [provideService(motionService, { reduced })],
      dispose: () => query?.removeEventListener('change', onChange),
      provides: motionSettings.map((setting) =>
        provide(settingsValueSpec, setting)
      ),
    }),
  }
}, 'motion')
