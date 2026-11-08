import '@src/lib/projectSession/next/testFeature'
import { EditorSelection } from '@codemirror/state'
import { createEditorDocument } from '@src/lib/editors/document'
import { signal } from '@preact/signals-core'
import { defineRegistryItem, provide, Registry, Slot } from '@kittycad/registry'
import type { Editor } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorCapabilityValueSpec,
  executorsService,
  type Executor,
  type ExecutorCapability,
  type ExecutorRunContext,
  defineExecutorCapability,
} from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

describe('executors extension', () => {
  let registry: Registry
  let slot: Slot
  let disposers: (() => void)[]
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => {
    registry = new Registry()
    slot = new Slot()
    disposers = []
    registry.configure([executorsExtension, slot.of()])
  })
  afterEach(() => {
    registry[Symbol.dispose]()
    for (const dispose of disposers) dispose()
  })

  const openEditor = (src = 'notes.md', contents = 'original') => {
    const source = signal(src)
    const backing = createEditorDocument(contents)
    const editor = {
      ...backing.document,
      get state() {
        return backing.document.state
      },
      id: Symbol(src),
      src: source,
      classification: signal(undefined),
      close: backing.dispose,
    }
    disposers.push(backing.dispose)
    return editor
  }
  const contribute = (...capabilities: ExecutorCapability[]) => {
    registry.reconfigure(slot, [
      defineRegistryItem({
        id: 'test-executor-capabilities',
        provides: capabilities.map((capability) =>
          provide(executorCapabilityValueSpec, capability)
        ),
      }),
    ])
  }
  const settled = (executor: Executor) =>
    vi.waitFor(() => expect(executor.output.value.running).toBe(false))
  const edit = (editor: Editor, contents: string) => {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: contents },
    })
  }

  it('creates executors explicitly without an editors service, including multiple for one editor', async () => {
    const editor = openEditor()
    const service = registry.get(executorsService)
    expect(service.executors.value).toEqual([])
    const first = service.createExecutor(editor)
    const second = service.createExecutor(editor)
    expect(first.id).not.toBe(second.id)
    expect(first.editor).toBe(editor)
    await settled(first)
    expect(first.output.value).toEqual({
      get: expect.any(Function),
      src: 'notes.md',
      contents: 'original',
      running: false,
      data: {},
      errors: {},
    })
    service.closeExecutor(first.id)
    expect(service.executors.value).toEqual([second])
    edit(editor, 'changed')
    expect(second.output.value.contents).toBe('changed')
    expect(first.output.value.contents).toBe('original')
    expect(editor.state.doc.toString()).toBe('changed')
  })

  it('runs wildcard and matching file types and combines sync and async data by capability ID', async () => {
    const ignored = vi.fn(() => ({ wrong: true }))
    contribute(
      {
        id: 'common',
        matches: '*',
        execute: (contents) => ({ length: contents.length }),
      },
      {
        id: 'markdown',
        matches: '.md',
        execute: async (contents) => ({ length: contents.length + 1 }),
      },
      { id: 'kcl', matches: '.kcl', execute: ignored }
    )
    const executor = registry
      .get(executorsService)
      .createExecutor(openEditor('notes.MD'))
    expect(executor.output.value.running).toBe(true)
    await settled(executor)
    expect(executor.output.value.data).toEqual({
      common: { length: 8 },
      markdown: { length: 9 },
    })
    expect(executor.output.value.errors).toEqual({})
    expect(ignored).not.toHaveBeenCalled()
  })

  it('keeps typed lookups bound to the capability that produced each snapshot', async () => {
    const first = defineExecutorCapability({
      id: 'preview',
      matches: '*' as const,
      execute: (contents) => ({ html: contents }),
    })
    const replacement = defineExecutorCapability({
      id: 'preview',
      matches: '*' as const,
      execute: async (contents) => ({ count: contents.length }),
    })
    contribute(first)
    const executor = registry.get(executorsService).createExecutor(openEditor())
    expect(executor.output.value.get(first)).toBeUndefined()
    await settled(executor)
    const original = executor.output.value
    expect(original.get(first)?.html).toBe('original')
    expect(original.get(replacement)).toBeUndefined()
    contribute(replacement)
    expect(executor.output.value.get(first)).toBeUndefined()
    await settled(executor)
    expect(executor.output.value.get(replacement)?.count).toBe(8)
    expect(executor.output.value.get(first)).toBeUndefined()
    expect(original.get(first)?.html).toBe('original')
    contribute()
    expect(executor.output.value.get(replacement)).toBeUndefined()
  })

  it('collects returned errors, thrown errors and rejected promises without losing successful data', async () => {
    const returned = new Error('returned')
    const thrown = new Error('thrown')
    contribute(
      { id: 'returned', matches: '*', execute: () => returned },
      {
        id: 'thrown',
        matches: '*',
        execute: () => {
          throw thrown
        },
      },
      {
        id: 'rejected',
        matches: '*',
        execute: () => Promise.reject('rejected'),
      },
      { id: 'success', matches: '*', execute: () => ({ answer: 42 }) }
    )
    const executor = registry.get(executorsService).createExecutor(openEditor())
    await settled(executor)
    expect(executor.output.value.data).toEqual({ success: { answer: 42 } })
    expect(executor.output.value.errors).toEqual({
      returned,
      thrown,
      rejected: new Error('rejected'),
    })
  })

  it('watches contents, coalesces synchronous edits, and ignores selection changes', async () => {
    const execute = vi.fn((contents: string) => ({ contents }))
    contribute({ id: 'echo', matches: '*', execute })
    const editor = openEditor()
    const executor = registry.get(executorsService).createExecutor(editor)
    await settled(executor)
    editor.dispatch({ selection: EditorSelection.cursor(1) })
    expect(execute).toHaveBeenCalledTimes(1)
    edit(editor, 'intermediate')
    edit(editor, 'latest')
    expect(executor.output.value.data).toEqual({})
    await settled(executor)
    expect(execute.mock.calls.map(([contents]) => contents)).toEqual([
      'original',
      'latest',
    ])
    expect(executor.output.value.data).toEqual({ echo: { contents: 'latest' } })
  })

  it('discards older async results even when they finish after a newer run', async () => {
    const old = deferred<Record<string, unknown>>()
    const execute = vi.fn((contents: string) =>
      contents === 'original' ? old.promise : { contents }
    )
    contribute({ id: 'echo', matches: '*', execute })
    const editor = openEditor()
    const executor = registry.get(executorsService).createExecutor(editor)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    edit(editor, 'latest')
    await settled(executor)
    const latest = executor.output.value
    old.resolve({ contents: 'stale' })
    await old.promise
    // Allow all continuations of the obsolete run to finish.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(executor.output.value).toBe(latest)
  })

  it('aborts obsolete work on rename and reacts to source changes within the same type', async () => {
    const pending = deferred<Record<string, unknown>>()
    const markdown = vi.fn((_contents: string, context: ExecutorRunContext) => {
      expect(context.src).toBe('notes.md')
      return pending.promise
    })
    const kcl = vi.fn((_contents: string, context: ExecutorRunContext) => ({
      src: context.src,
    }))
    contribute(
      { id: 'markdown', matches: '.md', execute: markdown },
      { id: 'kcl', matches: '.kcl', execute: kcl }
    )
    const editor = openEditor()
    const executor = registry.get(executorsService).createExecutor(editor)
    await vi.waitFor(() => expect(markdown).toHaveBeenCalledOnce())
    const oldContext = markdown.mock.calls[0][1]
    expect(oldContext.editor).toBe(editor)
    const oldSignal = oldContext.signal
    editor.src.value = 'parts/main.KCL'
    expect(oldContext.src).toBe('notes.md')
    expect(oldContext.editor.src.value).toBe('parts/main.KCL')
    await vi.waitFor(() => expect(oldSignal.aborted).toBe(true))
    await settled(executor)
    expect(executor.output.value).toMatchObject({
      src: 'parts/main.KCL',
      data: { kcl: { src: 'parts/main.KCL' } },
      errors: {},
    })
    editor.src.value = 'moved/main.kcl'
    await settled(executor)
    expect(executor.output.value.data).toEqual({
      kcl: { src: 'moved/main.kcl' },
    })
    expect(kcl).toHaveBeenCalledTimes(2)
    expect(kcl.mock.calls[1][1].editor).toBe(editor)
    pending.resolve({ obsolete: true })
    await pending.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(executor.output.value.errors).toEqual({})
    expect(executor.output.value.data).toEqual({
      kcl: { src: 'moved/main.kcl' },
    })
  })

  it('publishes completed capabilities while another is still pending, then coalesces the final output', async () => {
    const slow = deferred<Record<string, unknown>>()
    contribute(
      { id: 'slow', matches: '*', execute: () => slow.promise },
      { id: 'fast', matches: '*', execute: () => ({ ready: true }) }
    )
    const executor = registry.get(executorsService).createExecutor(openEditor())
    await vi.waitFor(() =>
      expect(executor.output.value.data.fast).toEqual({ ready: true })
    )
    expect(executor.output.value).toMatchObject({
      running: true,
      data: { fast: { ready: true } },
      errors: {},
    })
    slow.resolve({ done: true })
    await settled(executor)
    expect(executor.output.value.data).toEqual({
      slow: { done: true },
      fast: { ready: true },
    })
  })

  it('keeps executors isolated when different editors share the same source', async () => {
    contribute({
      id: 'echo',
      matches: '*',
      execute: (contents) => ({ contents }),
    })
    const first = openEditor('shared.md', 'first')
    const second = openEditor('shared.md', 'second')
    const service = registry.get(executorsService)
    const firstExecutor = service.createExecutor(first)
    const secondExecutor = service.createExecutor(second)
    await settled(firstExecutor)
    await settled(secondExecutor)
    edit(first, 'changed')
    await settled(firstExecutor)
    expect(firstExecutor.output.value.data).toEqual({
      echo: { contents: 'changed' },
    })
    expect(secondExecutor.output.value.data).toEqual({
      echo: { contents: 'second' },
    })
  })

  it('discards in-flight results when their capability is removed', async () => {
    const pending = deferred<Record<string, unknown>>()
    const execute = vi.fn(() => pending.promise)
    contribute({ id: 'removed', matches: '*', execute })
    const executor = registry.get(executorsService).createExecutor(openEditor())
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    contribute()
    const empty = executor.output.value
    expect(empty).toMatchObject({ running: false, data: {}, errors: {} })
    pending.resolve({ obsolete: true })
    await pending.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(executor.output.value).toBe(empty)
  })

  it('reacts to relevant capability changes and removal while ignoring unrelated contributions', async () => {
    const execute = vi.fn(() => ({ initial: true }))
    const capability: ExecutorCapability = {
      id: 'markdown',
      matches: '.md',
      execute,
    }
    contribute(capability)
    const executor = registry.get(executorsService).createExecutor(openEditor())
    await settled(executor)
    contribute(capability, {
      id: 'kcl',
      matches: '.kcl',
      execute: () => ({}),
    })
    expect(execute).toHaveBeenCalledOnce()
    const replacement: ExecutorCapability = {
      id: 'markdown',
      matches: '.md',
      execute: () => ({ replaced: true }),
    }
    contribute(replacement)
    await settled(executor)
    expect(executor.output.value.data).toEqual({ markdown: { replaced: true } })
    contribute()
    await settled(executor)
    expect(executor.output.value.data).toEqual({})
  })

  it.each(['close', 'destroy editor', 'dispose registry'] as const)(
    'stops watchers and discards pending results on %s',
    async (action) => {
      const pending = deferred<Record<string, unknown>>()
      const execute = vi.fn(() => pending.promise)
      contribute({ id: 'pending', matches: '*', execute })
      const editor = openEditor()
      const service = registry.get(executorsService)
      const executor = service.createExecutor(editor)
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
      if (action === 'close') service.closeExecutor(executor.id)
      if (action === 'destroy editor') editor.close()
      if (action === 'dispose registry') registry[Symbol.dispose]()
      expect(service.executors.value).toEqual([])
      const output = executor.output.value
      expect(output.running).toBe(false)
      pending.resolve({ stale: true })
      await pending.promise
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(executor.output.value).toBe(output)
      if (action !== 'destroy editor') edit(editor, 'still editable')
      expect(execute).toHaveBeenCalledOnce()
    }
  )
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
