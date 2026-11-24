import { signal } from '@preact/signals-core'
import { createSceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import { createSettings } from '@src/lib/settings/initialSettings'
import { createTestKclExecutionSettings } from '@src/lib/kcl/scene/executionSettingsTestUtils'
import { Registry, slot } from 'plankton'
import { coreKclExecutionInputs } from '@src/lib/kcl/scene/executionSettingsRegistry'
import {
  kclExecutionInputsFacet,
  provideKclExecutionInput,
} from '@src/lib/kcl/scene/executionSettingsContract'
import kclExtension from '@src/lib/kcl/registry'
import { editorLanguagesFacet } from '@src/lib/editors/registry/contract'
import { expect, it, vi } from 'vitest'
vi.mock('@src/lib/kcl/scene/open', () => ({ openKclScene: vi.fn() }))
vi.mock('@src/lib/kcl/modeling/KclScene', () => ({ KclScene: () => null }))

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

it.each(['streamed', 'local'] as const)(
  'uses effective default units in the native configuration and refreshes %s execution',
  (renderer) => {
    const settings = createSettings()
    settings.modeling.defaultUnit.user = 'mm'
    const snapshots = createTestKclExecutionSettings(() => settings)
    const revision = snapshots.revision(() => renderer === 'local')
    const millimeters = revision.peek()
    const streamed = snapshots.streamedRevision.peek()
    expect(snapshots.configuration.peek().settings?.modeling?.base_unit).toBe(
      'mm'
    )

    settings.modeling.defaultUnit.project = 'in'
    const inches = revision.peek()
    expect(inches).not.toBe(millimeters)
    expect(snapshots.configuration.peek().settings?.modeling?.base_unit).toBe(
      'in'
    )

    settings.modeling.defaultUnit.user = 'ft'
    expect(revision.peek()).toBe(inches)
    expect(snapshots.configuration.peek().settings?.modeling?.base_unit).toBe(
      'in'
    )

    settings.modeling.defaultUnit.project = undefined
    expect(revision.peek()).not.toBe(inches)
    expect(snapshots.configuration.peek().settings?.modeling?.base_unit).toBe(
      'ft'
    )
    expect(snapshots.streamedRevision.peek()).toBe(streamed)
  }
)

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

it('refreshes streamed backface settings while local rendering updates directly', () => {
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

it('composes added and removed KCL inputs for every consumer without changing setting definitions', async () => {
  const registry = new Registry()
  const extra = slot([])
  await registry.configure([coreKclExecutionInputs, extra])
  const settings = createSettings()
  const inputs = registry.observe(kclExecutionInputsFacet)
  const first = createSceneExecutionSettings(() => settings, inputs)
  const second = createSceneExecutionSettings(() => settings, inputs)
  const baseline = first.executeRevision.peek()
  const legacyBaseline = first.legacyExecuteRevision.peek()
  try {
    settings.modeling.enableTouchControls.user = false
    expect(first.executeRevision.peek()).toBe(baseline)
    expect(first.legacyExecuteRevision.peek()).toBe(legacyBaseline)
    await registry.replace(extra, [
      [
        provideKclExecutionInput({
          id: 'test.touch-controls',
          read: (s) => s.modeling.enableTouchControls.currentSignal.value,
          refresh: 'execute',
        }),
      ],
    ])
    const registered = first.executeRevision.peek()
    const legacyRegistered = first.legacyExecuteRevision.peek()
    expect(registered).not.toBe(baseline)
    expect(legacyRegistered).not.toBe(legacyBaseline)
    settings.modeling.enableTouchControls.user = true
    expect(first.executeRevision.peek()).not.toBe(registered)
    expect(second.executeRevision.peek()).toBe(first.executeRevision.peek())
    expect(first.legacyExecuteRevision.peek()).not.toBe(legacyRegistered)
    expect(second.legacyExecuteRevision.peek()).toBe(
      first.legacyExecuteRevision.peek()
    )
    await registry.replace(extra, [])
    expect(first.executeRevision.peek()).toBe(baseline)
    expect(first.legacyExecuteRevision.peek()).toBe(legacyBaseline)
    settings.modeling.enableTouchControls.user = false
    expect(first.executeRevision.peek()).toBe(baseline)
    expect(second.executeRevision.peek()).toBe(baseline)
    expect(first.legacyExecuteRevision.peek()).toBe(legacyBaseline)
    expect(second.legacyExecuteRevision.peek()).toBe(legacyBaseline)
  } finally {
    await registry.dispose()
  }
})

it('keeps legacy KCL refresh inputs installed when project-shell editing is disabled', async () => {
  const registry = new Registry()
  await registry.configure([kclExtension])
  try {
    await Promise.resolve()
    expect(registry.get(editorLanguagesFacet)).toEqual([])
    const settings = createSettings()
    const snapshots = createSceneExecutionSettings(
      () => settings,
      registry.observe(kclExecutionInputsFacet)
    )
    const before = snapshots.executeRevision.peek()
    settings.modeling.highlightEdges.user = false
    expect(snapshots.executeRevision.peek()).not.toBe(before)
  } finally {
    await registry.dispose()
  }
})
