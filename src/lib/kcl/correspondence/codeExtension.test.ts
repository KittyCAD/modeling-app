import { expect, it, vi } from 'vitest'
import { StateEffect, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { signal } from '@preact/signals-core'
import { correspondenceCodeExtension } from '@src/lib/kcl/correspondence/codeExtension'
import { createCorrespondenceBridge } from '@src/lib/kcl/correspondence/bridge'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import { createExecutorOutput } from '@src/lib/executors/output'
import type { SceneSelection } from '@src/lib/scene/selection'

it('decorates code without moving its cursor or echoing a pick, but accepts intentional Code selection', async () => {
  const model = modelingTestContext(),
    bridge = createCorrespondenceBridge()
  model.editor.dispatch({
    changes: {
      from: 0,
      to: model.editor.state.doc.length,
      insert: 'a'.repeat(80),
    },
  })
  model.context.executor = {
    ...model.context.executor,
    output: signal(
      createExecutorOutput({
        contents: model.editor.contents.peek(),
        src: '/main.kcl',
        running: false,
      })
    ),
  }
  model.resource.runtime.state.value.artifactGraph.set('segment', {
    type: 'segment',
    id: 'segment',
    pathId: 'path',
    edgeIds: [],
    commonSurfaceIds: [],
    codeRef: { range: [10, 20, 0], pathToNode: [], nodePath: { steps: [] } },
  })
  bridge.registerModel({ id: Symbol(), context: model.context })
  const view = new EditorView({ doc: model.editor.contents.peek() })
  const instance = {
    id: Symbol(),
    editor: model.editor,
    element: signal<HTMLElement | undefined>(view.dom),
    codeView: signal<EditorView | undefined>(view),
  }
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      correspondenceCodeExtension(
        { instance, editor: model.editor, view, onDispose: () => {} },
        bridge
      )
    ),
  })
  const values = signal<readonly SceneSelection[]>([])
  const picking = model.resource.selection.beginPicking({
    arguments: [
      {
        id: 'profiles',
        filter: ['curve'],
        multiple: true,
        value: values,
        accepts: (entity) => entity.type === 'segment',
        setValue: (next) => {
          values.value = next
        },
      },
    ],
  })
  if (picking instanceof Error) throw picking
  picking.activate('profiles')
  try {
    model.resource.selection.offer([
      {
        model: model.resource.selection.model.peek()!,
        reference: { type: 'segment', path_id: 'path', segment_id: 'segment' },
      },
    ])
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(view.state.selection.main.head).toBe(0)
    expect(
      view.dom.querySelector('.cm-geometry-correspondence')?.textContent
    ).toBe('a'.repeat(10))
    values.value = []
    // Programmatic cursor changes must not become command-input intent.
    view.dispatch({ selection: { anchor: 12 } })
    expect(values.peek()).toEqual([])
    view.dispatch({
      selection: { anchor: 13 },
      annotations: Transaction.userEvent.of('select.pointer'),
    })
    expect(values.peek().map((item) => item.reference)).toEqual([
      { type: 'segment', path_id: 'path', segment_id: 'segment' },
    ])
    expect(model.resource.selection.selected.peek()).toEqual([])
  } finally {
    picking.close()
    view.destroy()
    bridge.dispose()
    model.dispose()
  }
})

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))
