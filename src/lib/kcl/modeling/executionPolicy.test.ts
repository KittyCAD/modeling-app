import type { Editor } from '@src/lib/editors/registry/contract'
import { createProjectSources } from '@src/lib/projectSession/next/sources'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { effect, signal } from '@preact/signals-core'
import { createEditorDocument } from '@src/lib/editors/document'
import { createExecutor } from '@src/lib/executors/executor'
import { createKclExecution } from '@src/lib/kcl/execution/executor'
import { createKclViewExecution } from '@src/lib/kcl/modeling/viewExecution'
import { acquireKclExecutionPolicy } from '@src/lib/kcl/modeling/executionPolicy'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { emptyExecState } from '@src/lang/wasm'
import type { KclSession } from '@src/lib/kcl/modeling/session'
import { beforeAll, expect, it, onTestFinished, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
function fixture(automatic = false) {
  const source = createEditorDocument('original')
  const editor = {
    ...source.document,
    id: Symbol(),
    src: signal('/main.kcl'),
    classification: signal({ languageId: 'kcl' }),
    readOnly: signal(false),
  }
  const imported = signal('original import')
  const enabled = signal(automatic)
  const settings = signal(1)
  const capture = vi.fn(async (text: string) => ({
    src: '/main.kcl',
    files: new Map([
      ['/main.kcl', new TextEncoder().encode(text)],
      ['/import.kcl', new TextEncoder().encode(imported.peek())],
    ]),
  }))
  const execution = createKclExecution((text) => capture(text), imported)
  const owned = createExecutor(editor, signal([execution.capability]), () => {})
  const views = Array.from({ length: 2 }, () => {
    const session = {
      execute: vi.fn<KclSession['execute']>(async () => ({
        result: emptyExecState(),
      })),
      dispose: vi.fn(),
    }
    const view = createKclViewExecution(
      owned.executor,
      execution.capability,
      session,
      () => settings.value,
      () => ({ unit: settings.peek() })
    )
    const release = acquireKclExecutionPolicy(
      owned.executor,
      execution.capability,
      view,
      () => enabled.value,
      () => settings.value
    )
    onTestFinished(() => {
      release()
      view.dispose()
    })
    return { view, session }
  })
  onTestFinished(() => {
    owned.dispose()
    source.dispose()
  })
  return {
    ...owned,
    views,
    imported,
    enabled,
    settings,
    capture,
    capability: execution.capability,
    edit: (text: string) =>
      source.document.dispatch({
        changes: {
          from: 0,
          to: source.document.state.doc.length,
          insert: text,
        },
      }),
  }
}

it('renders the initial model with automation off, retaining stale geometry until an explicit request', async () => {
  const f = fixture()
  await vi.waitFor(() =>
    expect(f.views.every(({ view }) => view.state.peek().result)).toBe(true)
  )
  expect(f.capture).toHaveBeenCalledOnce()
  const retained = f.views.map(({ view }) => view.state.peek().result)
  f.edit('changed')
  f.imported.value = 'changed import'
  f.settings.value = 2
  await Promise.resolve()
  for (const [index, { view, session }] of f.views.entries()) {
    expect(view.state.peek()).toMatchObject({
      stale: true,
      running: false,
      result: retained[index],
    })
    expect(session.execute).toHaveBeenCalledOnce()
  }
  await f.executor.run(f.capability)
  await vi.waitFor(() =>
    expect(f.views.every(({ view }) => !view.state.peek().stale)).toBe(true)
  )
  expect(f.capture).toHaveBeenCalledTimes(2)
  for (const { session } of f.views) {
    const [snapshot, , configuration] = session.execute.mock.calls[1]
    expect(new TextDecoder().decode(snapshot.files.get('/main.kcl'))).toBe(
      'changed'
    )
    expect(new TextDecoder().decode(snapshot.files.get('/import.kcl'))).toBe(
      'changed import'
    )
    expect(configuration).toEqual({ unit: 2 })
  }
})

it('replays retained source and settings on recovery while automatic rendering is off', async () => {
  const f = fixture()
  await vi.waitFor(() =>
    expect(f.views[0].view.state.peek().result).toBeDefined()
  )
  const first = f.views[0].session.execute.mock.calls[0]
  f.edit('unrequested')
  f.settings.value = 2
  f.views[0].view.refresh()
  await vi.waitFor(() =>
    expect(f.views[0].session.execute).toHaveBeenCalledTimes(2)
  )
  expect(f.views[0].session.execute.mock.calls[1][0]).toBe(first[0])
  expect(f.views[0].session.execute.mock.calls[1][2]).toEqual({ unit: 1 })
  expect(f.views[1].session.execute).toHaveBeenCalledOnce()
  expect(f.capture).toHaveBeenCalledOnce()
  expect(f.views[0].view.state.peek().stale).toBe(true)
})

it('catches up once when automatic rendering is enabled and stops scheduling when disabled', async () => {
  const f = fixture()
  await vi.waitFor(() =>
    expect(f.views[1].view.state.peek().result).toBeDefined()
  )
  f.edit('latest')
  f.settings.value = 2
  f.enabled.value = true
  await vi.waitFor(() => {
    for (const { view } of f.views)
      expect(view.state.peek()).toMatchObject({ stale: false, running: false })
  })
  expect(f.capture).toHaveBeenCalledTimes(2)
  for (const { session } of f.views)
    expect(session.execute).toHaveBeenCalledTimes(2)
  f.enabled.value = false
  f.edit('off again')
  await Promise.resolve()
  expect(f.capture).toHaveBeenCalledTimes(2)
  expect(f.views[0].view.state.peek().stale).toBe(true)
})

it('lets native work finish against captured input when the source changes with automation off', async () => {
  const f = fixture()
  await vi.waitFor(() =>
    expect(f.views[1].view.state.peek().result).toBeDefined()
  )
  const pending =
    Promise.withResolvers<Awaited<ReturnType<KclSession['execute']>>>()
  f.views[0].session.execute.mockReturnValueOnce(pending.promise)
  await f.executor.run(f.capability)
  await vi.waitFor(() =>
    expect(f.views[0].session.execute).toHaveBeenCalledTimes(2)
  )
  const signal = f.views[0].session.execute.mock.calls[1][1]
  f.edit('newer')
  expect(signal.aborted).toBe(false)
  const result = emptyExecState()
  pending.resolve({ result })
  await vi.waitFor(() =>
    expect(f.views[0].view.state.peek()).toMatchObject({
      result,
      stale: true,
      running: false,
    })
  )
})

it('retains older geometry as stale when an explicit replacement fails', async () => {
  const f = fixture()
  await vi.waitFor(() =>
    expect(f.views[0].view.state.peek().result).toBeDefined()
  )
  const retained = f.views[0].view.state.peek().result
  f.edit('invalid')
  f.views[0].session.execute.mockResolvedValueOnce(new Error('Invalid KCL'))
  await f.executor.run(f.capability)
  await vi.waitFor(() =>
    expect(f.views[0].view.state.peek()).toMatchObject({
      result: retained,
      stale: true,
      error: new Error('Invalid KCL'),
      running: false,
    })
  )
})

it('keeps the requested settings when source preparation finishes after a preference change', async () => {
  const f = fixture()
  await vi.waitFor(() =>
    expect(f.views.every(({ view }) => view.state.peek().result)).toBe(true)
  )
  const initialSources = await f.capture.mock.results[0].value
  const pending = Promise.withResolvers<typeof initialSources>()
  f.capture.mockReturnValueOnce(pending.promise)
  const requested = f.executor.run(f.capability)
  f.settings.value = 2
  pending.resolve(initialSources)
  await requested
  await vi.waitFor(() => {
    for (const { session } of f.views)
      expect(session.execute).toHaveBeenCalledTimes(2)
  })
  for (const { view, session } of f.views) {
    expect(session.execute.mock.calls[1][2]).toEqual({ unit: 1 })
    expect(view.state.peek().stale).toBe(true)
  }
})

it("keeps a newer request's settings while the previous native execution finishes", async () => {
  const f = fixture()
  await vi.waitFor(() =>
    expect(f.views.every(({ view }) => view.state.peek().result)).toBe(true)
  )
  const pending =
    Promise.withResolvers<Awaited<ReturnType<KclSession['execute']>>>()
  f.views[0].session.execute.mockReturnValueOnce(pending.promise)
  await f.executor.run(f.capability)
  await vi.waitFor(() =>
    expect(f.views[0].session.execute).toHaveBeenCalledTimes(2)
  )
  f.settings.value = 2
  await f.executor.run(f.capability)
  f.settings.value = 3
  pending.resolve({ result: emptyExecState() })
  await vi.waitFor(() =>
    expect(f.views[0].session.execute).toHaveBeenCalledTimes(3)
  )
  expect(f.views[0].session.execute.mock.calls[2][2]).toEqual({ unit: 2 })
  expect(f.views[0].view.state.peek().stale).toBe(true)
})

it.each([false, true])(
  'opening an unchanged imported buffer preserves model freshness (automatic: %s)',
  async (automatic) => {
    const encode = (text: string) => new TextEncoder().encode(text)
    const projects = createProjectSessionService({
      readFile: async () =>
        encode('@settings(kclVersion = 3.0)\nexport width = 10'),
      writeFile: async () => {},
    })
    projects.openProject({
      contents: {
        name: 'Model',
        path: '/model',
        children: ['main.kcl', 'module.kcl'].map((name) => ({
          name,
          path: `/model/${name}`,
          children: null,
        })),
      },
      metadata: { title: 'Model', readWriteAccess: true },
    })
    const document = createEditorDocument(
      '@settings(kclVersion = 3.0)\nimport width from "module.kcl"\nanswer = width'
    )
    const editor = {
      ...document.document,
      id: Symbol(),
      src: signal('/model/main.kcl'),
      classification: signal({ languageId: 'kcl' }),
      readOnly: signal(false),
    }
    const documents = signal<readonly Pick<Editor, 'src' | 'contents'>[]>([
      editor,
    ])
    const sources = createProjectSources(
      () => projects,
      () => documents.value
    )
    const execution = createKclExecution(
      (contents, context) =>
        sources.capture({
          document: { src: context.src, contents },
          unnamedPath: 'main.kcl',
          signal: context.signal,
        }),
      sources.revision
    )
    const owned = createExecutor(
      editor,
      signal([execution.capability]),
      () => {}
    )
    const session = {
      execute: vi.fn<KclSession['execute']>(async () => ({
        result: emptyExecState(),
      })),
      dispose: vi.fn(),
    }
    const view = createKclViewExecution(
      owned.executor,
      execution.capability,
      session
    )
    const release = acquireKclExecutionPolicy(
      owned.executor,
      execution.capability,
      view,
      () => automatic,
      () => undefined
    )
    const freshness: boolean[] = []
    let stop = () => {}
    try {
      await vi.waitFor(() =>
        expect(view.state.peek()).toMatchObject({
          running: false,
          stale: false,
        })
      )
      expect(session.execute).toHaveBeenCalledOnce()
      stop = effect(() => {
        freshness.push(view.state.value.stale)
      })
      const imported = signal('@settings(kclVersion = 3.0)\nexport width = 10')
      documents.value = [
        editor,
        { src: signal('/model/module.kcl'), contents: imported },
      ]
      expect(view.state.peek().stale).toBe(false)
      expect(freshness).not.toContain(true)
      await Promise.resolve()
      expect(session.execute).toHaveBeenCalledOnce()
      imported.value = '@settings(kclVersion = 3.0)\nexport width = 20'
      expect(view.state.peek().stale).toBe(true)
      if (!automatic) {
        expect(session.execute).toHaveBeenCalledOnce()
        await owned.executor.run(execution.capability)
      }
      await vi.waitFor(() => {
        expect(session.execute).toHaveBeenCalledTimes(2)
        expect(view.state.peek()).toMatchObject({
          running: false,
          stale: false,
        })
      })
      expect(
        new TextDecoder().decode(
          session.execute.mock.calls[1][0].files.get('/model/module.kcl')
        )
      ).toContain('width = 20')
    } finally {
      stop()
      release()
      view.dispose()
      owned.dispose()
      document.dispose()
      projects.closeProject()
    }
  }
)
