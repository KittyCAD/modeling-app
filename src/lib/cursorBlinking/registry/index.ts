import { computed, effect } from '@preact/signals-core'
import { observations as settingsObservations } from '@src/registry/contracts/settings'
import { extension as defineExtension, type Extension } from 'plankton'
/** Apply the cursor preference to native text inputs throughout the app. */
export default defineExtension({
  dependencies: { settings: settingsObservations },
  key: 'cursor-blinking',
  create: ({ settings: settingsInputs }) => {
    const blinking = computed(
      () =>
        settingsInputs.settingsService.current.value?.current.value.textEditor
          .blinkingCursor.currentSignal.value
    )
    return {
      start: () => {
        if (typeof document === 'undefined') return
        const style = document.documentElement.style
        const previous = style.getPropertyValue('--cursor-color')
        const priority = style.getPropertyPriority('--cursor-color')
        const stopEffect = effect(() => {
          const shouldBlink = blinking.value
          if (shouldBlink === undefined) return
          style.setProperty(
            '--cursor-color',
            shouldBlink ? 'auto' : 'transparent'
          )
        })
        return () => {
          stopEffect()
          if (previous) style.setProperty('--cursor-color', previous, priority)
          else style.removeProperty('--cursor-color')
        }
      },
    }
  },
}) satisfies Extension
