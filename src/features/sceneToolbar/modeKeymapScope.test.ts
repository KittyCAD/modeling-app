import { signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import type { SceneMode } from '@src/contracts/sceneModes'
import { syncModeKeymapScope } from '@src/features/sceneToolbar/modeKeymapScope'

const mode = (id: string, keymapScope?: string): SceneMode => ({
  id,
  title: id,
  ...(keymapScope ? { keymapScope } : {}),
})

const harness = (initial: SceneMode | null) => {
  const active = signal<SceneMode | null>(initial)
  const applied: string[] = []
  const removed: string[] = []

  const stop = syncModeKeymapScope({
    active,
    applyScope: (id) => applied.push(id),
    removeScope: (id) => removed.push(id),
  })

  return { active, applied, removed, stop }
}

describe('holding a mode keymap scope', () => {
  it('applies the active mode scope immediately', () => {
    const app = harness(mode('modeling', 'mode.modeling'))

    expect(app.applied).toEqual(['mode.modeling'])
    app.stop()
  })

  /* Scopes stack, so every mode ever visited would otherwise stay live. */
  it('drops the old scope before applying the new one', () => {
    const app = harness(mode('modeling', 'mode.modeling'))

    app.active.value = mode('sketching', 'mode.sketching')

    expect(app.removed).toEqual(['mode.modeling'])
    expect(app.applied).toEqual(['mode.modeling', 'mode.sketching'])
    app.stop()
  })

  it('does nothing when the mode changes but the scope does not', () => {
    const app = harness(mode('modeling', 'mode.modeling'))

    // A mode object rebuilt by a re-render, or a mode sharing a scope.
    app.active.value = mode('modeling', 'mode.modeling')

    expect(app.applied).toEqual(['mode.modeling'])
    expect(app.removed).toEqual([])
    app.stop()
  })

  it('holds nothing for a mode that declares no scope', () => {
    const app = harness(mode('annotating'))

    expect(app.applied).toEqual([])
    app.stop()
    expect(app.removed).toEqual([])
  })

  it('releases the scope when a mode without one becomes active', () => {
    const app = harness(mode('modeling', 'mode.modeling'))

    app.active.value = mode('annotating')

    expect(app.removed).toEqual(['mode.modeling'])
    app.stop()
    expect(app.removed).toEqual(['mode.modeling'])
  })

  it('releases the scope when there is no mode at all', () => {
    const app = harness(mode('modeling', 'mode.modeling'))

    app.active.value = null

    expect(app.removed).toEqual(['mode.modeling'])
    app.stop()
  })

  it('releases the held scope on dispose', () => {
    const app = harness(mode('modeling', 'mode.modeling'))

    app.stop()

    expect(app.removed).toEqual(['mode.modeling'])
  })

  it('does not release twice, or react after dispose', () => {
    const app = harness(mode('modeling', 'mode.modeling'))

    app.stop()
    app.active.value = mode('sketching', 'mode.sketching')

    expect(app.removed).toEqual(['mode.modeling'])
    expect(app.applied).toEqual(['mode.modeling'])
  })
})
