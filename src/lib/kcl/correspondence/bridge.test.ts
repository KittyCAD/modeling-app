import { expect, it, vi } from 'vitest'
import { signal } from '@preact/signals-core'
import type { Artifact } from '@src/lang/wasm'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import { createExecutorOutput } from '@src/lib/executors/output'
import { createCorrespondenceBridge } from '@src/lib/kcl/correspondence/bridge'
import type { SceneSelection } from '@src/lib/scene/selection'

function fixture() {
  const view = modelingTestContext()
  view.editor.dispatch({
    changes: {
      from: 0,
      to: view.editor.state.doc.length,
      insert: ' '.repeat(80),
    },
  })
  view.context.executor = {
    ...view.context.executor,
    output: signal(
      createExecutorOutput({
        contents: view.editor.contents.peek(),
        src: '/main.kcl',
        running: false,
      })
    ),
  }
  const artifacts: Artifact[] = [
    {
      type: 'segment',
      id: 'segment',
      pathId: 'sketch',
      codeRef: { range: [10, 20, 0], pathToNode: [], nodePath: { steps: [] } },
      edgeIds: [],
      commonSurfaceIds: [],
    },
  ]
  view.resource.runtime.state.value = {
    ...view.resource.runtime.state.peek(),
    artifactGraph: new Map(artifacts.map((item) => [item.id, item])),
  }
  return view
}
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))
function picking(view: ReturnType<typeof fixture>) {
  const values = signal<readonly SceneSelection[]>([])
  const session = view.resource.selection.beginPicking({
    arguments: [
      {
        id: 'profiles',
        filter: ['curve'],
        multiple: true,
        value: values,
        accepts: (reference) => reference.type === 'segment',
        setValue: (next) => {
          values.value = next
        },
      },
    ],
  })
  if (session instanceof Error) throw session
  session.activate('profiles')
  return { values, session }
}

it('highlights N linked views without changing their view selections, and removes highlights on unlink', async () => {
  const first = fixture(),
    second = fixture()
  const bridge = createCorrespondenceBridge()
  const code = Symbol(),
    a = Symbol(),
    b = Symbol()
  const decorate = vi.fn()
  try {
    bridge.registerCode({ id: code, editor: first.editor, decorate })
    bridge.registerModel({ id: a, context: first.context })
    bridge.registerModel({ id: b, context: second.context })
    const unlink = bridge.link(code, b)
    if (unlink instanceof Error) throw unlink
    bridge.selectCode(code, [[12, 12, 0]])
    await flush()
    for (const view of [first, second]) {
      expect(
        view.resource.selection.correspondence
          .peek()
          .map((item) => item.reference)
      ).toEqual([{ type: 'segment', segment_id: 'segment', path_id: 'sketch' }])
      expect(view.resource.selection.selected.peek()).toEqual([])
    }
    unlink()
    await flush()
    expect(second.resource.selection.correspondence.peek()).toEqual([])
    expect(first.resource.selection.correspondence.peek()).toHaveLength(1)
    first.editor.dispatch({ changes: { from: 0, insert: '// edited\n' } })
    await flush()
    expect(first.resource.selection.correspondence.peek()).toEqual([])
    expect(decorate).toHaveBeenLastCalledWith([])
  } finally {
    bridge.dispose()
    first.dispose()
    second.dispose()
  }
})

it('requires an explicit destination for linked picking when multiple models are present', async () => {
  const first = fixture(),
    second = fixture()
  const bridge = createCorrespondenceBridge(),
    code = Symbol(),
    a = Symbol(),
    b = Symbol()
  try {
    bridge.registerCode({ id: code, editor: first.editor, decorate: () => {} })
    bridge.registerModel({ id: a, context: first.context })
    bridge.registerModel({ id: b, context: second.context })
    bridge.link(code, b)
    const firstPick = picking(first),
      secondPick = picking(second)
    bridge.selectCode(code, [[12, 12, 0]])
    expect(firstPick.values.peek()).toEqual([])
    expect(secondPick.values.peek()).toEqual([])
    bridge.setPickingTarget(code, b)
    bridge.selectCode(code, [[12, 12, 0]])
    expect(firstPick.values.peek()).toEqual([])
    expect(secondPick.values.peek().map((item) => item.reference)).toEqual([
      { type: 'segment', path_id: 'sketch', segment_id: 'segment' },
    ])
    expect(second.resource.selection.selected.peek()).toEqual([])
    second.resource.selection.invalidate()
    bridge.selectCode(code, [[12, 12, 0]])
    expect(secondPick.values.peek()).toEqual([])
    firstPick.session.close()
    secondPick.session.close()
  } finally {
    bridge.dispose()
    first.dispose()
    second.dispose()
  }
})

it('decorates every linked Code view from dialog selection without generating a new pick', async () => {
  const view = fixture(),
    bridge = createCorrespondenceBridge()
  const first = vi.fn(),
    second = vi.fn()
  try {
    bridge.registerModel({ id: Symbol(), context: view.context })
    bridge.registerCode({ id: Symbol(), editor: view.editor, decorate: first })
    bridge.registerCode({ id: Symbol(), editor: view.editor, decorate: second })
    const pick = picking(view)
    view.resource.selection.offer([
      {
        model: view.resource.selection.model.peek()!,
        reference: {
          type: 'segment',
          segment_id: 'segment',
          path_id: 'sketch',
        },
      },
    ])
    await flush()
    expect(first).toHaveBeenLastCalledWith([[10, 20, 0]])
    expect(second).toHaveBeenLastCalledWith([[10, 20, 0]])
    expect(pick.values.peek()).toHaveLength(1)
    expect(view.resource.selection.selected.peek()).toEqual([])
    pick.session.close()
    await flush()
    expect(first).toHaveBeenLastCalledWith([])
  } finally {
    bridge.dispose()
    view.dispose()
  }
})

it('does not silently choose between repeated geometry produced at the same source range', () => {
  const view = fixture(),
    bridge = createCorrespondenceBridge(),
    code = Symbol()
  try {
    const state = view.resource.runtime.state.peek()
    const first = state.artifactGraph.get('segment')!
    state.artifactGraph.set('other', { ...first, id: 'other' })
    bridge.registerModel({ id: Symbol(), context: view.context })
    bridge.registerCode({ id: code, editor: view.editor, decorate: () => {} })
    const pick = picking(view)
    bridge.selectCode(code, [[12, 12, 0]])
    expect(pick.values.peek()).toEqual([])
    expect(bridge.error.peek()?.message).toContain('one compatible entity')
    pick.session.close()
  } finally {
    bridge.dispose()
    view.dispose()
  }
})

it('resolves imported-source module IDs against the target execution and rejects changed imported bytes', async () => {
  const model = fixture(),
    codeView = fixture(),
    bridge = createCorrespondenceBridge()
  const code = Symbol(),
    target = Symbol(),
    decorate = vi.fn()
  try {
    codeView.editor.src.value = '/part.kcl'
    const state = model.resource.runtime.state.peek()
    const segment = state.artifactGraph.get('segment')!
    if (segment.type !== 'segment') throw new Error('Expected segment fixture')
    state.artifactGraph.set('segment', {
      ...segment,
      codeRef: { ...segment.codeRef, range: [10, 20, 1] },
    })
    model.resource.runtime.state.value = {
      ...state,
      filenames: {
        1: { type: 'Local', value: '/part.kcl', original_import_path: null },
      },
    }
    model.resource.runtime.sources.value = {
      src: '/main.kcl',
      files: new Map([
        [
          '/part.kcl',
          new TextEncoder().encode(codeView.editor.contents.peek()),
        ],
      ]),
    }
    bridge.registerCode({ id: code, editor: codeView.editor, decorate })
    bridge.registerModel({ id: target, context: model.context })
    bridge.link(code, target)
    bridge.selectCode(code, [[12, 12, 0]])
    await flush()
    expect(model.resource.selection.correspondence.peek()).toHaveLength(1)
    const pick = picking(model)
    bridge.selectCode(code, [[12, 12, 0]])
    expect(pick.values.peek()).toHaveLength(1)
    await flush()
    expect(decorate).toHaveBeenLastCalledWith([[10, 20, 1]])
    codeView.editor.dispatch({ changes: { from: 0, insert: 'changed' } })
    pick.values.value = []
    bridge.selectCode(code, [[12, 12, 0]])
    await flush()
    expect(pick.values.peek()).toEqual([])
    expect(decorate).toHaveBeenLastCalledWith([])
    pick.session.close()
  } finally {
    bridge.dispose()
    model.dispose()
    codeView.dispose()
  }
})

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))

it('does not route picks to a retained Modeling context after its view switches presentation', async () => {
  const view = fixture(),
    bridge = createCorrespondenceBridge(),
    enabled = signal(true),
    code = Symbol()
  try {
    bridge.registerCode({ id: code, editor: view.editor, decorate: () => {} })
    bridge.registerModel({ id: Symbol(), context: view.context, enabled })
    bridge.selectCode(code, [[12, 12, 0]])
    await flush()
    expect(view.resource.selection.correspondence.peek()).toHaveLength(1)
    const pick = picking(view)
    enabled.value = false
    bridge.selectCode(code, [[12, 12, 0]])
    await flush()
    expect(pick.values.peek()).toEqual([])
    expect(view.resource.selection.correspondence.peek()).toEqual([])
    pick.session.close()
  } finally {
    bridge.dispose()
    view.dispose()
  }
})
