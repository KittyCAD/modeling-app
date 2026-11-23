import { batch, signal } from '@preact/signals-core'
import { observeLegacySceneExecutionSettings } from '@src/lib/kcl/scene/legacyExecutionSettings'
import { createSettings } from '@src/lib/settings/initialSettings'
import { createTestKclExecutionSettings } from '@src/lib/kcl/scene/executionSettingsTestUtils'
import { expect, it, vi } from 'vitest'

function observer() {
  const settings = createSettings()
  const active = signal(false)
  const local = signal(false)
  const connected = signal(true)
  const execute = vi.fn(async () => {})
  const current = signal(true)
  const snapshots = createTestKclExecutionSettings(() => settings)
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
    dispose,
  }
}

it('keeps inactive baselines current and batches refresh inputs for the active scene', () => {
  const state = observer()
  try {
    state.settings.modeling.highlightEdges.user = false
    expect(state.execute).not.toHaveBeenCalled()
    state.active.value = true
    expect(state.execute).not.toHaveBeenCalled()
    batch(() => {
      state.settings.modeling.showScaleGrid.user = true
      state.settings.modeling.fixedSizeGrid.user = false
    })
    expect(state.execute).toHaveBeenCalledOnce()
    state.dispose()
    state.settings.modeling.highlightEdges.user = true
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

it('refreshes streamed backface color through ordinary execution', () => {
  const state = observer()
  try {
    state.active.value = true
    state.settings.modeling.backfaceColor.user = '#123456'
    expect(state.execute).toHaveBeenCalledOnce()
  } finally {
    state.dispose()
  }
})

it('keeps local backface changes out of native refresh', () => {
  const state = observer()
  try {
    state.local.value = true
    state.active.value = true
    state.settings.modeling.backfaceColor.user = '#123456'
    expect(state.execute).not.toHaveBeenCalled()
  } finally {
    state.dispose()
  }
})

it.each(['inactive', 'disconnected', 'replaced'] as const)(
  'does not execute backface changes for an %s scene',
  (owner) => {
    const state = observer()
    try {
      state.active.value = owner !== 'inactive'
      state.connected.value = owner !== 'disconnected'
      state.current.value = owner !== 'replaced'
      state.settings.modeling.backfaceColor.user = '#123456'
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
  const state = observer()
  try {
    state.local.value = true
    state.active.value = true
    state.settings.modeling.backfaceColor.user = '#123456'
    expect(state.execute).not.toHaveBeenCalled()
    state.local.value = false
    expect(state.execute).not.toHaveBeenCalled()
    state.settings.modeling.backfaceColor.user = '#654321'
    expect(state.execute).toHaveBeenCalledOnce()
  } finally {
    state.dispose()
  }
})
