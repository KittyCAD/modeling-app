import { batch, signal } from '@preact/signals-core'
import { createSceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import type { KclExecutionInput } from '@src/lib/kcl/scene/executionSettingsContract'
import { coreKclExecutionInputDefinitions } from '@src/lib/kcl/scene/executionSettingsRegistry'
import { observeLegacySceneExecutionSettings } from '@src/lib/kcl/scene/legacyExecutionSettings'
import { createSettings } from '@src/lib/settings/initialSettings'
import { expect, it, vi } from 'vitest'

function observer(inputs = coreKclExecutionInputDefinitions) {
  const settings = createSettings()
  const active = signal(false)
  const local = signal(false)
  const connected = signal(true)
  const execute = vi.fn(async () => {})
  const current = signal(true)
  const declarations = signal(inputs)
  const snapshots = createSceneExecutionSettings(() => settings, declarations)
  const dispose = observeLegacySceneExecutionSettings({
    settings: snapshots,
    active: () => active.value,
    connected: () => connected.value,
    geometryOnly: () => local.value,
    capture: () => ({
      execute,
      isCurrent: () => active.peek() && current.peek(),
    }),
  })
  return {
    settings,
    active,
    local,
    connected,
    execute,
    current,
    declarations,
    dispose,
  }
}

it('keeps inactive baselines current and batches refresh inputs for the active scene', () => {
  const state = observer()
  try {
    state.settings.modeling.defaultUnit.user = 'mm'
    expect(state.execute).not.toHaveBeenCalled()
    state.active.value = true
    expect(state.execute).not.toHaveBeenCalled()
    batch(() => {
      state.settings.modeling.defaultUnit.user = 'in'
      state.settings.modeling.defaultUnit.project = 'ft'
    })
    expect(state.execute).toHaveBeenCalledOnce()
    state.dispose()
    state.settings.modeling.defaultUnit.project = undefined
    expect(state.execute).toHaveBeenCalledOnce()
  } finally {
    state.dispose()
  }
})

it.each(['streamed', 'local'] as const)(
  'reexecutes the active %s scene only when its effective default unit changes',
  (renderer) => {
    const state = observer()
    try {
      state.settings.modeling.defaultUnit.user = 'mm'
      state.local.value = renderer === 'local'
      state.active.value = true
      expect(state.execute).not.toHaveBeenCalled()

      state.settings.modeling.defaultUnit.project = 'in'
      expect(state.execute).toHaveBeenCalledOnce()
      state.settings.modeling.defaultUnit.user = 'ft'
      expect(state.execute).toHaveBeenCalledOnce()
      state.settings.modeling.defaultUnit.project = undefined
      expect(state.execute).toHaveBeenCalledTimes(2)
    } finally {
      state.dispose()
    }
  }
)

it.each(['streamed', 'local'] as const)(
  'leaves visual settings to direct APIs for the active %s legacy scene',
  (renderer) => {
    const state = observer()
    try {
      state.local.value = renderer === 'local'
      state.active.value = true
      state.settings.modeling.highlightEdges.user = false
      expect(state.execute).not.toHaveBeenCalled()
      state.settings.modeling.showScaleGrid.user = true
      expect(state.execute).not.toHaveBeenCalled()
      state.settings.modeling.fixedSizeGrid.user = false
      expect(state.execute).not.toHaveBeenCalled()
      state.settings.modeling.backfaceColor.user = '#123456'
      expect(state.execute).not.toHaveBeenCalled()
    } finally {
      state.dispose()
    }
  }
)

it.each(['inactive', 'disconnected', 'replaced'] as const)(
  'does not execute default unit changes for an %s scene',
  (owner) => {
    const state = observer()
    try {
      state.active.value = owner !== 'inactive'
      state.connected.value = owner !== 'disconnected'
      state.current.value = owner !== 'replaced'
      state.settings.modeling.defaultUnit.project = 'in'
      expect(state.execute).not.toHaveBeenCalled()
      state.active.value = true
      state.connected.value = true
      expect(state.execute).not.toHaveBeenCalled()
    } finally {
      state.dispose()
    }
  }
)

it('uses the current connection renderer for the next setting change without refreshing on a renderer switch alone', () => {
  const state = observer([
    {
      id: 'test.touch-controls',
      read: (settings) =>
        settings.modeling.enableTouchControls.currentSignal.value,
      refresh: 'execute-streamed',
    },
  ])
  try {
    state.local.value = true
    state.active.value = true
    state.settings.modeling.enableTouchControls.user = false
    expect(state.execute).not.toHaveBeenCalled()
    state.local.value = false
    expect(state.execute).not.toHaveBeenCalled()
    state.settings.modeling.enableTouchControls.user = true
    expect(state.execute).toHaveBeenCalledOnce()
  } finally {
    state.dispose()
  }
})

it('follows added and removed execution contributions in the legacy scene', () => {
  const state = observer([])
  const input: KclExecutionInput = {
    id: 'test.touch-controls',
    read: (settings) =>
      settings.modeling.enableTouchControls.currentSignal.value,
    refresh: 'execute',
  }
  try {
    state.active.value = true
    state.declarations.value = [input]
    expect(state.execute).toHaveBeenCalledOnce()
    state.settings.modeling.enableTouchControls.user = false
    expect(state.execute).toHaveBeenCalledTimes(2)
    state.declarations.value = []
    expect(state.execute).toHaveBeenCalledTimes(3)
    state.settings.modeling.enableTouchControls.user = true
    expect(state.execute).toHaveBeenCalledTimes(3)
  } finally {
    state.dispose()
  }
})
