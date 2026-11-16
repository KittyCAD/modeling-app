import { signal } from '@preact/signals-core'
import { createSceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import { createSettings } from '@src/lib/settings/initialSettings'
import { createTestKclExecutionSettings } from '@src/lib/kcl/scene/executionSettingsTestUtils'
import { Registry, Slot, defineRegistryItem } from '@kittycad/registry'
import { coreKclExecutionInputs } from '@src/lib/kcl/scene/executionSettingsRegistry'
import {
  kclExecutionInputsValueSpec,
  provideKclExecutionInput,
} from '@src/lib/kcl/scene/executionSettingsContract'
import kclExtension from '@src/lib/kcl/registry'
import { editorLanguagesValueSpec } from '@src/lib/editors/registry/contract'
import { expect, it } from 'vitest'

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
