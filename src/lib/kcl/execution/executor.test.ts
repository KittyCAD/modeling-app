import { acquireKclExecutionPolicy } from '@src/lib/kcl/modeling/executionPolicy'
import { acquireAutomaticExecution } from '@src/lib/executors/automatic'
import { signal } from '@preact/signals-core'
import { emptyExecState } from '@src/lang/wasm'
import { createEditorDocument } from '@src/lib/editors/document'
import type { Editor } from '@src/lib/editors/registry/contract'
import { createExecutor } from '@src/lib/executors/executor'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { createKclExecution } from '@src/lib/kcl/execution/executor'
import { createKclViewExecution as createManualKclViewExecution } from '@src/lib/kcl/modeling/viewExecution'
import type { KclSession } from '@src/lib/kcl/modeling/session'
import { createKclSession } from '@src/lib/kcl/modeling/session'
import { afterEach, beforeAll, expect, it, onTestFinished, vi } from 'vitest'
import { createTestKclScene } from '@src/lib/kcl/testFixtures'

const createKclViewExecution: typeof createManualKclViewExecution = (
  executor,
  capability,
  session,
  revision = () => undefined
) => {
  const view = createManualKclViewExecution(
    executor,
    capability,
    session,
    revision
  )
  const release = acquireKclExecutionPolicy(
    executor,
    capability,
    view,
    () => true,
    revision
  )
  return {
    ...view,
    dispose: () => {
      release()
      view.dispose()
    },
  }
}

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
afterEach(() => vi.unstubAllGlobals())

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
function sharedExecution() {
  const source = editor()
  const dependency = signal('21')
  const capture = vi.fn(async (contents: string, src: string) => ({
    src,
    files: new Map([
      [src, new TextEncoder().encode(contents)],
      ['/module.kcl', new TextEncoder().encode(dependency.peek())],
    ]),
  }))
  const execution = createKclExecution(
    (contents, context) => capture(contents, context.src),
    dependency
  )
  const owned = createExecutor(
    source.editor,
    signal([execution.capability]),
    () => {}
  )
  const release = acquireAutomaticExecution(
    owned.executor,
    execution.capability
  )
  return {
    source,
    dependency,
    capture,
    execution,
    executor: owned.executor,
    dispose: () => {
      release()
      owned.dispose()
      source.dispose()
    },
  }
}

it('captures imports once and supplies the same snapshot to independent native sessions', async () => {
  const f = sharedExecution()
  const resultA = { ...emptyExecState(), engineSceneGeneration: 10 }
  const resultB = { ...emptyExecState(), engineSceneGeneration: 20 }
  const sessionA = {
    dispose: vi.fn(),
    execute: vi.fn<KclSession['execute']>(async () => ({ result: resultA })),
  }
  const sessionB = {
    dispose: vi.fn(),
    execute: vi.fn<KclSession['execute']>(async () => ({ result: resultB })),
  }
  const one = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionA
  )
  const two = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionB
  )
  onTestFinished(() => {
    one.dispose()
    two.dispose()
    f.dispose()
  })
  await vi.waitFor(() => {
    expect(one.state.peek().result).toBe(resultA)
    expect(two.state.peek().result).toBe(resultB)
  })
  expect(f.capture).toHaveBeenCalledOnce()
  expect(sessionA.execute.mock.calls[0][0]).toBe(
    sessionB.execute.mock.calls[0][0]
  )
  expect(f.executor.output.peek().get(f.execution.capability)?.sources).toBe(
    sessionA.execute.mock.calls[0][0]
  )
  f.dependency.value = '22'
  await vi.waitFor(() => {
    expect(sessionA.execute).toHaveBeenCalledTimes(2)
    expect(sessionB.execute).toHaveBeenCalledTimes(2)
  })
  expect(f.capture).toHaveBeenCalledTimes(2)
  expect(sessionB.execute.mock.calls[1][0].files.get('/module.kcl')).toEqual(
    new TextEncoder().encode('22')
  )
})

it('refreshes settings in one view without recapturing sources or replacing a sibling result', async () => {
  const f = sharedExecution()
  const revision = signal(0)
  const sessionA = {
    dispose: vi.fn(),
    execute: vi.fn<KclSession['execute']>(async () => ({
      result: emptyExecState(),
    })),
  }
  const sessionB = {
    dispose: vi.fn(),
    execute: vi.fn<KclSession['execute']>(async () => ({
      result: emptyExecState(),
    })),
  }
  const one = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionA,
    () => revision.value
  )
  const two = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionB
  )
  onTestFinished(() => {
    one.dispose()
    two.dispose()
    f.dispose()
  })
  await vi.waitFor(() => expect(two.state.peek().result).toBeDefined())
  const sibling = two.state.peek()
  revision.value++
  await vi.waitFor(() => expect(sessionA.execute).toHaveBeenCalledTimes(2))
  one.refresh()
  await vi.waitFor(() => expect(sessionA.execute).toHaveBeenCalledTimes(3))
  expect(f.capture).toHaveBeenCalledOnce()
  expect(sessionB.execute).toHaveBeenCalledOnce()
  expect(two.state.peek()).toBe(sibling)
})

it('ignores superseded scene replies and keeps a failing scene out of shared executor errors', async () => {
  const f = sharedExecution()
  const pending =
    Promise.withResolvers<Awaited<ReturnType<KclSession['execute']>>>()
  const current = { ...emptyExecState(), engineSceneGeneration: 2 }
  const failure = new Error('Only this connection failed')
  const sessionA = {
    dispose: vi.fn(),
    execute: vi
      .fn<KclSession['execute']>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ result: current }),
  }
  const sessionB = {
    dispose: vi.fn(),
    execute: vi.fn<KclSession['execute']>(async () => failure),
  }
  const one = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionA
  )
  const two = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionB
  )
  onTestFinished(() => {
    one.dispose()
    two.dispose()
    f.dispose()
  })
  await vi.waitFor(() => expect(two.state.peek().error).toBe(failure))
  one.refresh()
  await vi.waitFor(() => expect(one.state.peek().result).toBe(current))
  pending.resolve({ result: emptyExecState() })
  await Promise.resolve()
  expect(one.state.peek().result).toBe(current)
  expect(f.executor.output.peek().errors).toEqual({})
  expect(two.state.peek().error).toBe(failure)
})

it('stops only the closed view while its sibling continues following the shared document', async () => {
  const f = sharedExecution()
  const pending =
    Promise.withResolvers<Awaited<ReturnType<KclSession['execute']>>>()
  const sessionA = {
    dispose: vi.fn(),
    execute: vi.fn<KclSession['execute']>(() => pending.promise),
  }
  const sessionB = {
    dispose: vi.fn(),
    execute: vi.fn<KclSession['execute']>(async () => ({
      result: emptyExecState(),
    })),
  }
  const one = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionA
  )
  const two = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionB
  )
  onTestFinished(() => {
    one.dispose()
    two.dispose()
    f.dispose()
  })
  await vi.waitFor(() => expect(sessionA.execute).toHaveBeenCalledOnce())
  one.dispose()
  expect(sessionA.execute.mock.calls[0][1].aborted).toBe(true)
  f.source.document.dispatch({
    changes: {
      from: 0,
      to: f.source.editor.state.doc.length,
      insert: 'answer = 84',
    },
  })
  await vi.waitFor(() => expect(sessionB.execute).toHaveBeenCalledTimes(2))
  pending.resolve({ result: emptyExecState() })
  await Promise.resolve()
  expect(one.state.peek().result).toBeUndefined()
  expect(sessionA.execute).toHaveBeenCalledOnce()
  expect(
    new TextDecoder().decode(
      sessionB.execute.mock.calls[1][0].files.get('/main.kcl')
    )
  ).toBe('answer = 84')
})

it('still permits explicitly independent executors of the same editor', async () => {
  const f = sharedExecution()
  const fork = createExecutor(
    f.source.editor,
    signal([f.execution.capability]),
    () => {}
  )
  await fork.executor.run(f.execution.capability)
  onTestFinished(() => {
    fork.dispose()
    f.dispose()
  })
  await vi.waitFor(() => {
    expect(f.executor.output.peek().get(f.execution.capability)).toBeDefined()
    expect(
      fork.executor.output.peek().get(f.execution.capability)
    ).toBeDefined()
  })
  const original = f.executor.output.peek()
  await fork.executor.run(f.execution.capability)
  await vi.waitFor(() => expect(f.capture).toHaveBeenCalledTimes(3))
  expect(f.executor.output.peek()).toBe(original)
})

it.each(['focus', 'manual'] as const)(
  'reconnects only the %s view from the latest shared sources',
  async (trigger) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    const f = sharedExecution()
    const initial = createTestKclScene('local'),
      fresh = createTestKclScene('local'),
      siblingResource = createTestKclScene('local')
    let disconnect: (error: Error) => void = () => {}
    let opening = 0
    let replay = () => {}
    const session = createKclSession(
      async (_size, _signal, closed) => {
        disconnect = closed
        return opening++ === 0 ? initial : fresh
      },
      () => replay()
    )
    const sibling = createKclSession(async () => siblingResource)
    const one = createKclViewExecution(
      f.executor,
      f.execution.capability,
      session
    )
    const two = createKclViewExecution(
      f.executor,
      f.execution.capability,
      sibling
    )
    replay = one.refresh
    const container = () => {
      const element = document.createElement('div')
      Object.defineProperties(element, {
        clientWidth: { value: 200 },
        clientHeight: { value: 150 },
      })
      return element
    }
    session.attach(container())
    sibling.attach(container())
    onTestFinished(() => {
      one.dispose()
      two.dispose()
      session.dispose()
      sibling.dispose()
      f.dispose()
    })
    await vi.waitFor(() => expect(two.state.peek().result).toBeDefined())
    disconnect(new Error('Connection expired'))
    f.source.document.dispatch({
      changes: {
        from: 0,
        to: f.source.editor.state.doc.length,
        insert: 'answer = 84',
      },
    })
    await vi.waitFor(() => {
      expect(one.state.peek().error).toBeDefined()
      expect(siblingResource.runtime.execute).toHaveBeenCalledTimes(2)
    })
    if (trigger === 'manual') session.reconnect()
    else window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => {
      expect(one.state.peek().error).toBeUndefined()
      expect(fresh.runtime.execute).toHaveBeenCalledOnce()
    })
    expect(
      new TextDecoder().decode(
        vi
          .mocked(fresh.runtime.execute)
          .mock.calls.at(-1)?.[0]
          .files.get('/main.kcl')
      )
    ).toBe('answer = 84')
    expect(siblingResource.runtime.execute).toHaveBeenCalledTimes(2)
    expect(siblingResource.dispose).not.toHaveBeenCalled()
    expect(f.capture).toHaveBeenCalledTimes(2)
    expect(f.executor.output.peek().errors).toEqual({})
  }
)

it('closes all scene sessions when their shared executor is explicitly closed', async () => {
  const f = sharedExecution()
  const sessionA = {
    execute: vi.fn<KclSession['execute']>(async () => ({
      result: emptyExecState(),
    })),
    dispose: vi.fn(),
  }
  const sessionB = {
    execute: vi.fn<KclSession['execute']>(async () => ({
      result: emptyExecState(),
    })),
    dispose: vi.fn(),
  }
  const one = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionA
  )
  const two = createKclViewExecution(
    f.executor,
    f.execution.capability,
    sessionB
  )
  onTestFinished(() => {
    one.dispose()
    two.dispose()
    f.dispose()
  })
  await vi.waitFor(() => expect(two.state.peek().result).toBeDefined())
  f.dispose()
  await vi.waitFor(() => {
    expect(sessionA.dispose).toHaveBeenCalledOnce()
    expect(sessionB.dispose).toHaveBeenCalledOnce()
  })
  expect(one.state.peek().running).toBe(false)
  expect(two.state.peek().running).toBe(false)
})
