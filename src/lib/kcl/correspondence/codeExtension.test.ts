import { expect, it, vi } from 'vitest'
import { StateEffect, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { signal } from '@preact/signals-core'
import { correspondenceCodeExtension } from '@src/lib/kcl/correspondence/codeExtension'
import { testCorrespondenceBridge as createCorrespondenceBridge } from '@src/lib/kcl/correspondence/testBridge'
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
        bridge.registrations
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

it('converts native UTF-8 ranges and CodeMirror UTF-16 selections without moving the cursor', async () => {
  const model = modelingTestContext(),
    bridge = createCorrespondenceBridge()
  const text = '// café 🌐\n' + 'a'.repeat(40),
    from = text.indexOf('a'.repeat(40)),
    to = from + 10
  model.editor.dispatch({
    changes: { from: 0, to: model.editor.state.doc.length, insert: text },
  })
  model.context.executor = {
    ...model.context.executor,
    output: signal(
      createExecutorOutput({ contents: text, src: '/main.kcl', running: false })
    ),
  }
  const byteStart = new TextEncoder().encode(text.slice(0, from)).length,
    byteEnd = byteStart + 10
  model.resource.runtime.state.value.artifactGraph.set('segment', {
    type: 'segment',
    id: 'segment',
    pathId: 'path',
    edgeIds: [],
    commonSurfaceIds: [],
    codeRef: {
      range: [byteStart, byteEnd, 0],
      pathToNode: [],
      nodePath: { steps: [] },
    },
  })
  bridge.registerModel({ id: Symbol(), context: model.context })
  const view = new EditorView({ doc: text }),
    instance = {
      id: Symbol(),
      editor: model.editor,
      element: signal<HTMLElement | undefined>(view.dom),
      codeView: signal<EditorView | undefined>(view),
    }
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      correspondenceCodeExtension(
        { instance, editor: model.editor, view, onDispose: () => {} },
        bridge.registrations
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
    expect(
      view.dom.querySelector('.cm-geometry-correspondence')?.textContent
    ).toBe(text.slice(from, to))
    expect(view.state.selection.main.head).toBe(0)
    values.value = []
    view.dispatch({
      selection: { anchor: from + 2 },
      annotations: Transaction.userEvent.of('select.pointer'),
    })
    expect(values.peek().map((item) => item.reference)).toEqual([
      { type: 'segment', path_id: 'path', segment_id: 'segment' },
    ])
  } finally {
    picking.close()
    view.destroy()
    bridge.dispose()
    model.dispose()
  }
})
