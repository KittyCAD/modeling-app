import { signal } from '@preact/signals-core'
import { emptyExecState } from '@src/lang/wasm'
import { createEditorDocument } from '@src/lib/editors/document'
import type { Editor } from '@src/lib/editors/registry/contract'
import { createExecutor } from '@src/lib/executors/executor'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { createKclExecution } from '@src/lib/kcl/executor'
import { createKclSession, type KclSession } from '@src/lib/kcl/session'
import type { KclSceneResource } from '@src/lib/kcl/scene'
import { beforeAll, expect, it, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
function editor() {
  const document = createEditorDocument('answer = width * 2')
  return {
    ...document,
    editor: {
      ...document.document,
      get state() {
        return document.document.state
      },
      id: Symbol(),
      src: signal('/main.kcl'),
      classification: signal({ languageId: 'kcl' }),
      readOnly: signal(false),
    } satisfies Editor,
  }
}
it('reruns unchanged entrypoints when imported inputs change, and isolates executor lifetimes', async () => {
  const source = editor()
  const dependency = signal('21')
  const sessions: KclSession[] = []
  const execution = createKclExecution(
    () => {
      const session = {
        execute: vi.fn(async () => ({ result: emptyExecState() })),
        dispose: vi.fn(),
      } as unknown as KclSession
      sessions.push(session)
      return session
    },
    async (contents, context) => ({
      src: context.src,
      files: new Map([
        ['/main.kcl', new TextEncoder().encode(contents)],
        ['/module.kcl', new TextEncoder().encode(dependency.peek())],
      ]),
    }),
    dependency
  )
  const capabilities = signal([execution.capability])
  const first = createExecutor(source.editor, capabilities, () => {})
  const second = createExecutor(source.editor, capabilities, () => {})
  const one = execution.getSession(first.executor)
  const two = execution.getSession(second.executor)
  try {
    expect(one).not.toBe(two)
    expect(execution.getSession(first.executor)).toBe(one)
    await vi.waitFor(() =>
      expect(first.executor.output.peek().running).toBe(false)
    )
    await vi.waitFor(() =>
      expect(second.executor.output.peek().running).toBe(false)
    )
    dependency.value = '22'
    await vi.waitFor(() => expect(one.execute).toHaveBeenCalledTimes(2))
    expect(
      vi.mocked(one.execute).mock.calls[1][0].files.get('/module.kcl')
    ).toEqual(new TextEncoder().encode('22'))
    first.dispose()
    await vi.waitFor(() => expect(one.dispose).toHaveBeenCalledOnce())
    expect(two.dispose).not.toHaveBeenCalled()
    dependency.value = '23'
    await vi.waitFor(() => expect(two.execute).toHaveBeenCalledTimes(3))
    expect(one.execute).toHaveBeenCalledTimes(2)
  } finally {
    first.dispose()
    second.dispose()
    source.dispose()
  }
  await vi.waitFor(() => expect(two.dispose).toHaveBeenCalledOnce())
})

it('re-executes the latest editor source and clears execution errors after focus reconnects its scene', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  const makeScene = () =>
    ({
      element: document.createElement('div'),
      presentation: 'local',
      preferences: signal({}),
      isConnected: () => true,
      runtime: { execute: vi.fn(async () => emptyExecState()) },
      resize: async () => {},
      applySettings: async () => {},
      resume: () => {},
      frameModel: async () => {},
      dispose: async () => {},
    }) as unknown as KclSceneResource
  const initial = makeScene(),
    fresh = makeScene()
  let disconnect: (error: Error) => void = () => {}
  let opening = 0
  const execution = createKclExecution(
    (executor) =>
      createKclSession(async (_size, _signal, onDisconnect) => {
        disconnect = onDisconnect
        return opening++ === 0 ? initial : fresh
      }, executor.refresh),
    async (contents, context) => ({
      src: context.src,
      files: new Map([[context.src, new TextEncoder().encode(contents)]]),
    })
  )
  const source = editor()
  const owned = createExecutor(
    source.editor,
    signal([execution.capability]),
    () => {}
  )
  const session = execution.getSession(owned.executor)
  const container = document.createElement('div')
  Object.defineProperties(container, {
    clientWidth: { value: 200 },
    clientHeight: { value: 150 },
  })
  const detach = session.mount(container)
  try {
    await vi.waitFor(() =>
      expect(owned.executor.output.peek().running).toBe(false)
    )
    disconnect(new Error('Idle session expired'))
    source.document.dispatch({
      changes: {
        from: 0,
        to: source.document.contents.peek().length,
        insert: 'answer = 84',
      },
    })
    await vi.waitFor(() =>
      expect(
        owned.executor.output.peek().errors['kcl.execution']
      ).toBeInstanceOf(Error)
    )
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => {
      expect(owned.executor.output.peek().running).toBe(false)
      expect(
        owned.executor.output.peek().errors['kcl.execution']
      ).toBeUndefined()
    })
    const request = vi.mocked(fresh.runtime.execute).mock.calls.at(-1)?.[0]
    expect(new TextDecoder().decode(request?.files.get('/main.kcl'))).toBe(
      'answer = 84'
    )
  } finally {
    detach()
    owned.dispose()
    source.dispose()
    vi.unstubAllGlobals()
  }
})
