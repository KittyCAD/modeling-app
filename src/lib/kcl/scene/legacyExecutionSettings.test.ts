import { batch, signal } from '@preact/signals-core'
import type { SceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
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
  const rebuild = vi.fn<
    (
      configuration: SceneExecutionSettings['configuration']['value']
    ) => Promise<void>
  >(async () => {})
  const current = signal(true)
  const snapshots = createTestKclExecutionSettings(() => settings)
  const dispose = observeLegacySceneExecutionSettings({
    settings: snapshots,
    active: () => active.value,
    connected: () => connected.value,
    geometryOnly: () => local.value,
    capture: () => ({
      execute,
      rebuild,
      isCurrent: () => active.peek() && current.peek(),
    }),
  })
  return {
    settings,
    active,
    local,
    connected,
    execute,
    rebuild,
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
    expect(state.rebuild).not.toHaveBeenCalled()
    state.dispose()
    state.settings.modeling.highlightEdges.user = true
    expect(state.execute).toHaveBeenCalledOnce()
  } finally {
    state.dispose()
  }
})

it('waits for a streamed rebuild before newer settings execute and ignores replaced owners', async () => {
  const state = observer()
  const pending = Promise.withResolvers<undefined>()
  state.rebuild.mockImplementation(async () => {
    await pending.promise
  })
  try {
    state.active.value = true
    state.settings.modeling.backfaceColor.user = '#123456'
    expect(state.rebuild).toHaveBeenCalledOnce()
    state.settings.modeling.highlightEdges.user = false
    expect(state.execute).not.toHaveBeenCalled()
    state.current.value = false
    pending.resolve(undefined)
    await pending.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.execute).not.toHaveBeenCalled()
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
    expect(state.rebuild).not.toHaveBeenCalled()
  } finally {
    state.dispose()
  }
})

it('applies the latest queued backface rebuild before executing a newer ordinary setting', async () => {
  const state = observer()
  const first = Promise.withResolvers<undefined>()
  const second = Promise.withResolvers<undefined>()
  state.rebuild
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise)
  try {
    state.active.value = true
    state.settings.modeling.backfaceColor.user = '#123456'
    state.settings.modeling.backfaceColor.user = '#654321'
    state.settings.modeling.highlightEdges.user = false
    expect(state.rebuild).toHaveBeenCalledOnce()
    expect(state.execute).not.toHaveBeenCalled()

    first.resolve(undefined)
    await vi.waitFor(() => expect(state.rebuild).toHaveBeenCalledTimes(2))
    expect(
      state.rebuild.mock.calls[1][0].settings?.modeling?.backface_color
    ).toBe('#654321')
    expect(state.execute).not.toHaveBeenCalled()
    second.resolve(undefined)
    await vi.waitFor(() => expect(state.execute).toHaveBeenCalledOnce())
  } finally {
    state.dispose()
    first.resolve(undefined)
    second.resolve(undefined)
  }
})

it.each(['close', 'deactivate', 'replace', 'reactivate', 'reconnect'] as const)(
  'does not restart queued refreshes after the scene owner changes (%s)',
  async (change) => {
    const state = observer()
    const first = Promise.withResolvers<undefined>()
    state.rebuild.mockImplementationOnce(() => first.promise)
    try {
      state.active.value = true
      state.settings.modeling.backfaceColor.user = '#123456'
      state.settings.modeling.backfaceColor.user = '#654321'
      state.settings.modeling.highlightEdges.user = false
      if (change === 'close') state.dispose()
      if (change === 'deactivate' || change === 'reactivate')
        state.active.value = false
      if (change === 'replace') state.current.value = false
      if (change === 'reactivate') state.active.value = true
      if (change === 'reconnect') {
        state.connected.value = false
        state.connected.value = true
      }
      first.resolve(undefined)
      await first.promise
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(state.rebuild).toHaveBeenCalledOnce()
      expect(state.execute).not.toHaveBeenCalled()
    } finally {
      state.dispose()
      first.resolve(undefined)
    }
  }
)
