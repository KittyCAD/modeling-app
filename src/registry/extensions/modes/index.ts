import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { batch, computed, effect, signal } from '@preact/signals-core'
import type { ToolbarModeName } from '@src/lib/toolbar'
import {
  type ModesRegistryService,
  modesService,
  modesValueSpec,
} from '@src/registry/contracts/modes'
import builtinModes from './builtinModes'

export const modesExtension = defineRegistryItemFactory(({ valueSpecs }) => {
  const modes = valueSpecs.signal(modesValueSpec)
  const selectedModeId = signal('modeling')
  const modelingMode = signal<ToolbarModeName>('modeling')
  const selectionAllowed = signal(true)
  const canSelectMode = computed(
    () => modelingMode.value === 'modeling' && selectionAllowed.value
  )
  const activeMode = computed(() => {
    const id =
      modelingMode.value === 'modeling'
        ? selectedModeId.value
        : modelingMode.value
    return (
      modes.value.find((mode) => mode.id === id) ??
      modes.value.find((mode) => mode.id === 'modeling')
    )
  })
  let stopWatchingSelection: (() => void) | undefined
  let disposed = false

  const serviceImpl: ModesRegistryService = {
    modes,
    selectedModeId,
    activeMode,
    canSelectMode,
    setMode: (id) => {
      if (
        disposed ||
        !canSelectMode.value ||
        !modes.value.some((mode) => mode.id === id && mode.selectable !== false)
      ) {
        return false
      }

      // Subscribe only when first used, after registry graph construction.
      // Removing a plugin clears its selection even if no view is reading the
      // active mode, so re-enabling it cannot unexpectedly reactivate its mode.
      stopWatchingSelection ??= effect(() => {
        if (
          selectedModeId.value !== 'modeling' &&
          !modes.value.some(
            (mode) =>
              mode.id === selectedModeId.value && mode.selectable !== false
          )
        ) {
          selectedModeId.value = 'modeling'
        }
      })
      selectedModeId.value = id
      return true
    },
    syncModelingMode: (mode, canSelect = true) => {
      if (disposed) return
      batch(() => {
        modelingMode.value = mode
        selectionAllowed.value = canSelect
      })
    },
    reset: () => {
      batch(() => {
        selectedModeId.value = 'modeling'
        modelingMode.value = 'modeling'
        selectionAllowed.value = true
      })
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'modes-extension',
      providesServices: [provideService(modesService, serviceImpl)],
      dispose: () => {
        disposed = true
        stopWatchingSelection?.()
        serviceImpl.reset()
      },
    }),
  }
}, 'modes-extension')

export default defineRegistryItem({
  id: 'modes',
  uses: [builtinModes, modesExtension],
})
