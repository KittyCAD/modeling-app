import { defineRegistryItemFactory } from '@kittycad/registry'
import { effect } from '@preact/signals-core'
import { settingsService } from '@src/registry/contracts/settings'

/** Apply the cursor preference to native text inputs throughout the app. */
export default defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
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
      const shouldBlink = current.textEditor.blinkingCursor.currentSignal.value
      style.setProperty('--cursor-color', shouldBlink ? 'auto' : 'transparent')
    })
    stop = () => {
      stopEffect()
      if (previous) style.setProperty('--cursor-color', previous, priority)
      else style.removeProperty('--cursor-color')
    }
  })

  return {
    id: 'cursor-blinking',
    dispose: () => {
      disposed = true
      stop?.()
    },
  }
}, 'cursor-blinking')
