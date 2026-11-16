import { batch, signal } from '@preact/signals-core'
import {
  type SceneExecutionSettings,
  createSceneExecutionSettings,
  observeSceneExecutionSettings,
} from '@src/lib/kcl/scene/settings'
import { createSettings } from '@src/lib/settings/initialSettings'
import { createTestKclExecutionSettings } from '@src/lib/kcl/scene/settingsTestUtils'
import { Registry, Slot, defineRegistryItem } from '@kittycad/registry'
import { coreKclExecutionInputs } from '@src/lib/kcl/scene/settingsRegistry'
import {
  kclExecutionInputsValueSpec,
  provideKclExecutionInput,
} from '@src/lib/kcl/scene/settingsContract'
import kclExtension from '@src/lib/kcl/registry'
import { editorLanguagesValueSpec } from '@src/lib/editors/registry/contract'
import { expect, it, vi } from 'vitest'

it('follows core KCL inputs and effective values rather than hidden overrides', () => {
  const settings = createSettings()
  const snapshots = createTestKclExecutionSettings(() => settings)
  const revision = snapshots.revision(() => false)
  const before = revision.peek()
  settings.textEditor.blinkingCursor.user = false
  settings.modeling.enableTouchControls.user =
    !settings.modeling.enableTouchControls.current
  expect(revision.peek()).toBe(before)
  settings.modeling.highlightEdges.project = true
  settings.modeling.highlightEdges.user = false
  expect(revision.peek()).toBe(before)
  settings.modeling.highlightEdges.project = undefined
  expect(revision.peek()).not.toBe(before)
  expect(
    snapshots.configuration.peek().settings?.modeling?.highlight_edges
  ).toBe(false)
})

it('preserves revisions across equivalent settings replacements and tracks the replacement', () => {
  const settings = signal(createSettings())
  const snapshots = createTestKclExecutionSettings(() => settings.value)
  const revision = snapshots.revision(() => false)
  const before = revision.peek()
  settings.value = createSettings()
  expect(revision.peek()).toBe(before)
  settings.value.modeling.showScaleGrid.user = true
  expect(revision.peek()).not.toBe(before)
  expect(
    snapshots.configuration.peek().settings?.modeling?.show_scale_grid
  ).toBe(true)
})

it('opts backface changes into streamed rebuilds while local rendering updates directly', () => {
  const settings = createSettings()
  const snapshots = createTestKclExecutionSettings(() => settings)
  const streamed = snapshots.revision(() => false)
  const local = snapshots.revision(() => true)
  const oldStreamed = streamed.peek()
  const oldLocal = local.peek()
  settings.modeling.backfaceColor.user = '#123456'
  expect(streamed.peek()).not.toBe(oldStreamed)
  expect(local.peek()).toBe(oldLocal)
  expect(
    snapshots.configuration.peek().settings?.modeling?.backface_color
  ).toBe('#123456')
})

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
  const dispose = observeSceneExecutionSettings({
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

it('composes added and removed KCL inputs for every consumer without changing setting definitions', () => {
  const registry = new Registry()
  const extra = new Slot()
  registry.configure([coreKclExecutionInputs, extra.of()])
  const settings = createSettings()
  const inputs = registry.signal(kclExecutionInputsValueSpec)
  const first = createSceneExecutionSettings(() => settings, inputs)
  const second = createSceneExecutionSettings(() => settings, inputs)
  const baseline = first.executeRevision.peek()
  try {
    settings.modeling.enableTouchControls.user = false
    expect(first.executeRevision.peek()).toBe(baseline)
    registry.reconfigure(extra, [
      defineRegistryItem({
        provides: [
          provideKclExecutionInput({
            id: 'test.touch-controls',
            read: (s) => s.modeling.enableTouchControls.currentSignal.value,
            refresh: 'execute',
          }),
        ],
      }),
    ])
    const registered = first.executeRevision.peek()
    expect(registered).not.toBe(baseline)
    settings.modeling.enableTouchControls.user = true
    expect(first.executeRevision.peek()).not.toBe(registered)
    expect(second.executeRevision.peek()).toBe(first.executeRevision.peek())
    registry.reconfigure(extra, [])
    expect(first.executeRevision.peek()).toBe(baseline)
    settings.modeling.enableTouchControls.user = false
    expect(first.executeRevision.peek()).toBe(baseline)
    expect(second.executeRevision.peek()).toBe(baseline)
  } finally {
    registry[Symbol.dispose]()
  }
})

it('keeps legacy KCL refresh inputs installed when project-shell editing is disabled', async () => {
  const registry = new Registry()
  registry.configure([kclExtension])
  try {
    await Promise.resolve()
    expect(registry.get(editorLanguagesValueSpec)).toEqual([])
    const settings = createSettings()
    const snapshots = createSceneExecutionSettings(
      () => settings,
      registry.signal(kclExecutionInputsValueSpec)
    )
    const before = snapshots.executeRevision.peek()
    settings.modeling.highlightEdges.user = false
    expect(snapshots.executeRevision.peek()).not.toBe(before)
  } finally {
    registry[Symbol.dispose]()
  }
})
