import { expect, it, vi } from 'vitest'
import { computed, signal } from '@preact/signals-core'
import { createEntityStyling } from '@src/lib/scene/entityStyling'
import { createSketchCorrespondence } from '@src/lib/kcl/sketch/correspondence'
import { nativeSketchDelta } from '@src/lib/kcl/sketch/correspondenceTestUtils'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import { testCorrespondenceBridge } from '@src/lib/kcl/correspondence/testBridge'
import type { ModelingInteractionSession } from '@src/lib/kcl/interactions'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))
function fixture(presentation: 'streamed' | 'local') {
  const view = modelingTestContext(presentation),
    bridge = testCorrespondenceBridge()
  const text = ' '.repeat(80)
  view.editor.dispatch({
    changes: { from: 0, to: view.editor.state.doc.length, insert: text },
  })
  const styling = createEntityStyling<number>(),
    selected = signal<SketchSolveSelectionId[]>([])
  const native = createSketchCorrespondence({
    editor: view.editor,
    src: '/main.kcl',
    sketchId: 0,
    surface: { selected, entityStyling: styling.service },
    sources: undefined,
    isCurrent: () => !view.editor.signal.aborted,
  })
  const session: ModelingInteractionSession = {
    id: 'native.sketch',
    correspondence: signal(native.endpoint),
    selection: signal({
      items: computed(() =>
        selected.value.map((id) => ({
          kind: 'sketch' as const,
          sessionId: view.editor.id,
          sketchId: 0,
          id,
        }))
      ),
      canClear: computed(() => !!selected.value.length),
      clear: () => {
        selected.value = []
      },
    }),
    toolbar: signal([]),
    prompt: signal('Sketch'),
    defaultPlanes: signal({ xy: false, xz: false, yz: false }),
    error: signal(undefined),
    escape: async () => {},
    dispose: async () => {},
  }
  view.context.interactions.active.value = session
  native.rendered(nativeSketchDelta(), text)
  bridge.registerModel({ id: Symbol(), context: view.context })
  return {
    view,
    bridge,
    native,
    styling,
    selected,
    text,
    close: () => {
      bridge.dispose()
      native.dispose()
      styling.dispose()
      view.dispose()
    },
  }
}
it.each(['streamed', 'local'] as const)(
  'bridges Code and native sketch selection in %s without consulting an ordinary execution or altering selections',
  async (presentation) => {
    const f = fixture(presentation),
      a = Symbol(),
      b = Symbol(),
      decorate = vi.fn()
    try {
      f.bridge.registerCode({ id: a, editor: f.view.editor, decorate })
      const closeB = f.bridge.registerCode({
        id: b,
        editor: f.view.editor,
        decorate: () => {},
      })
      f.bridge.selectCode(a, [[12, 12, 0]])
      f.bridge.selectCode(b, [[52, 52, 0]])
      await flush()
      const groups = f.styling.service.groups.peek()
      expect(groups.map((group) => group.entities)).toEqual([[1], [2]])
      expect(groups[0].style.color).not.toEqual(groups[1].style.color)
      expect(f.selected.peek()).toEqual([])
      expect(f.view.resource.selection.selected.peek()).toEqual([])
      f.selected.value = [1]
      await flush()
      expect(decorate).toHaveBeenLastCalledWith([[10, 20, 0]])
      expect(f.view.resource.commands.sendSceneCommand).not.toHaveBeenCalled()
      closeB()
      await flush()
      expect(f.styling.service.groups.peek()).toHaveLength(1)
      f.view.context.interactions.active.value = undefined
      await flush()
      expect(f.styling.service.groups.peek()).toEqual([])
    } finally {
      f.close()
    }
  }
)
it('suspends mismatched preview source and rejects delayed projections after a native graph revision', async () => {
  const f = fixture('streamed'),
    code = Symbol(),
    decorate = vi.fn()
  try {
    f.bridge.registerCode({ id: code, editor: f.view.editor, decorate })
    f.bridge.selectCode(code, [[12, 12, 0]])
    await flush()
    const old = f.native.endpoint.snapshot.peek()!
    f.native.rendered(nativeSketchDelta(), f.text + 'preview')
    await flush()
    expect(f.native.endpoint.snapshot.peek()).toBeUndefined()
    expect(f.styling.service.groups.peek()).toEqual([])
    expect(decorate).toHaveBeenLastCalledWith([])
    const next = nativeSketchDelta([30, 40, 0])
    f.native.rendered(next, f.text)
    f.native.endpoint.project(old, [
      {
        sourceViewId: code,
        ids: [1],
        style: {
          color: [1, 0, 0],
          fillOpacity: 1,
          outlineOpacity: 1,
          lineWidth: 1,
          priority: 1,
        },
      },
    ])
    await flush()
    expect(f.styling.service.groups.peek()).toEqual([])
    f.bridge.selectCode(code, [[32, 32, 0]])
    await flush()
    expect(
      f.styling.service.groups.peek().map((group) => group.entities)
    ).toEqual([[1]])
    const surviving = f.styling.service.groups.peek()
    f.native.endpoint.project(old, [])
    expect(f.styling.service.groups.peek()).toEqual(surviving)
    f.view.editor.dispatch({ changes: { from: 0, insert: 'external edit' } })
    await flush()
    expect(f.styling.service.groups.peek()).toEqual([])
  } finally {
    f.close()
  }
})

it('resolves native backtrace modules against captured imported bytes', async () => {
  const f = fixture('local'),
    imported = modelingTestContext(),
    code = Symbol(),
    modelId = Symbol(),
    decorate = vi.fn()
  try {
    imported.editor.src.value = '/part.kcl'
    imported.editor.dispatch({
      changes: {
        from: 0,
        to: imported.editor.state.doc.length,
        insert: f.text,
      },
    })
    const native = createSketchCorrespondence({
      editor: f.view.editor,
      src: '/main.kcl',
      sketchId: 0,
      surface: { selected: f.selected, entityStyling: f.styling.service },
      sources: {
        src: '/main.kcl',
        files: new Map([['/part.kcl', new TextEncoder().encode(f.text)]]),
      },
      isCurrent: () => true,
    })
    const delta = nativeSketchDelta()
    delta.exec_outcome.filenames = {
      1: { type: 'Local', value: '/part.kcl', original_import_path: null },
    }
    const active = f.view.context.interactions.active.peek()!
    active.correspondence = signal(native.endpoint)
    // Replace the active session value so consumers observe the new provider.
    f.view.context.interactions.active.value = { ...active }
    native.rendered(delta, f.text)
    f.bridge.registerModel({ id: modelId, context: f.view.context })
    f.bridge.registerCode({ id: code, editor: imported.editor, decorate })
    f.bridge.link(code, modelId)
    f.bridge.selectCode(code, [[32, 32, 0]])
    await flush()
    expect(
      f.styling.service.groups
        .peek()
        .some((group) => group.entities.includes(2))
    ).toBe(true)
    f.selected.value = [2]
    await flush()
    expect(decorate).toHaveBeenLastCalledWith([[30, 40, 1]])
    imported.editor.dispatch({ changes: { from: 0, insert: 'changed' } })
    await flush()
    expect(decorate).toHaveBeenLastCalledWith([])
    native.dispose()
  } finally {
    imported.dispose()
    f.close()
  }
})
