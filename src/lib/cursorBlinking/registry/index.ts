import { computed, effect } from '@preact/signals-core'
import { settingsService } from '@src/registry/contracts/settings'
import { extension as defineExtension, type Extension } from 'plankton'
/** Apply the cursor preference to native text inputs throughout the app. */
export default defineExtension({
  key: 'cursor-blinking',
  create: (_dependencies, ctx) => {
    const settings = computed(() => ctx.optional(settingsService))
    let disposed = false
    let stop: (() => void) | undefined

    // Wait until the registry has finished constructing its service providers.
    queueMicrotask(() => {
      if (disposed || typeof document === 'undefined') return
      const style = document.documentElement.style
      const previous = style.getPropertyValue('--cursor-color')
      const priority = style.getPropertyPriority('--cursor-color')
      const stopEffect = effect(() => {
        const current = settings.value?.current.value
        if (!current) return
        const shouldBlink =
          current.textEditor.blinkingCursor.currentSignal.value
        style.setProperty(
          '--cursor-color',
          shouldBlink ? 'auto' : 'transparent'
        )
      })
      stop = () => {
        stopEffect()
        if (previous) style.setProperty('--cursor-color', previous, priority)
        else style.removeProperty('--cursor-color')
      }
    })

    return {
      items: [],
      dispose: () => {
        disposed = true
        stop?.()
      },
    }
  },
}) satisfies Extension
