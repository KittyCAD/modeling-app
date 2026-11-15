import { requireSuccess } from '@src/lib/editors/testViews'
import { executionContext } from '@src/lib/executors/context'
import '@src/lib/projectSession/next/testFeature'
import { EditorSelection } from '@codemirror/state'
import { createEditorDocument } from '@src/lib/editors/document'
import { signal } from '@preact/signals-core'
import { contribute, Registry, slot } from 'plankton'
import type { Editor } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorCapabilityFacet,
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
  let capabilitySlot: ReturnType<typeof slot>
  let disposers: (() => void)[]
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(async () => {
    registry = new Registry()
    capabilitySlot = slot([])
    disposers = []
    await registry.configure([executorsExtension, capabilitySlot])
  })
  afterEach(async () => {
    await registry.dispose()
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
      readOnly: signal(false),
      close: backing.dispose,
    }
    disposers.push(backing.dispose)
    return editor
  }
  const installCapabilities = async (...capabilities: ExecutorCapability[]) => {
    await registry.replace(capabilitySlot, [
      capabilities.map((capability) =>
        contribute(executorCapabilityFacet, () => capability)
      ),
    ])
  }
  const settled = (executor: Executor) =>
    vi.waitFor(() => expect(executor.output.value.running).toBe(false))
  const edit = (editor: Editor, contents: string) => {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: contents },
    })
  }

  it('reruns unchanged text when additional inputs change', async () => {
    const revision = signal(1)
    const execute = vi.fn(() => ({ imported: revision.peek() }))
    contribute({ id: 'imports', matches: '*', revision, execute })
    const editor = openEditor()
    const executor = requireSuccess(
      registry.get(executorsService).createExecutor(editor)
    )
    await settled(executor)
    expect(executor.output.peek().data.imports).toEqual({ imported: 1 })
    revision.value = 2
    await settled(executor)
    expect(executor.output.peek().contents).toBe('original')
    expect(executor.output.peek().data.imports).toEqual({ imported: 2 })
    revision.value = 2
    await Promise.resolve()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it.each(['createExecutor', 'acquireExecutor'] as const)(
    'returns an error from %s for a closed editor without retaining an executor',
    (method) => {
      const editor = openEditor()
      const service = registry.required(executorsService)
      editor.close()

      expect(service[method](editor)).toEqual(new Error('The editor is closed'))
      expect(service.executors.peek()).toEqual([])
    }
  )

  it('returns an acquisition error from a mode context without registering cleanup', async () => {
    const editor = openEditor()
    const onDispose = vi.fn()
    const context = executionContext(
      { id: 'test', matches: '*', execute: () => ({}) },
      () => registry.required(executorsService)
    )
    editor.close()

    expect(
      context({
        editor,
        instance: {
          id: Symbol('view'),
          editor,
          element: signal(undefined),
          codeView: signal(undefined),
        },
        onDispose,
      })
    ).toEqual(new Error('The editor is closed'))
    expect(onDispose).not.toHaveBeenCalled()
    expect(registry.required(executorsService).executors.peek()).toEqual([])
  })

  it('reports a ready capability context while an unrelated computation remains pending', async () => {
    const pending = Promise.withResolvers<{ text: string }>()
    const ready = defineExecutorCapability({
      id: 'ready',
      matches: '*',
      execute: (text: string) => ({ text }),
    })
    const slow = defineExecutorCapability({
      id: 'slow',
      matches: '*',
      execute: () => pending.promise,
    })
    await installCapabilities(ready, slow)
    const editor = openEditor()
    const cleanup: Array<() => void> = []
    const context = requireSuccess(
      executionContext(ready, () => registry.required(executorsService))({
        editor,
        onDispose: (dispose) => cleanup.push(dispose),
        instance: {
          id: Symbol(),
          editor,
          element: signal(undefined),
          codeView: signal(undefined),
        },
      })
    )
    try {
      await vi.waitFor(() =>
        expect(context.result.value.data).toEqual({ text: 'original' })
      )
      expect(context.result.value.running).toBe(false)
      expect(context.executor.output.value.running).toBe(true)
    } finally {
      cleanup.reverse().forEach((dispose) => dispose())
      pending.resolve({ text: 'done' })
    }
  })

  it('creates executors explicitly without an editors service, including multiple for one editor', async () => {
    const editor = openEditor()
    const service = registry.required(executorsService)
    expect(service.executors.value).toEqual([])
    const first = requireSuccess(service.createExecutor(editor))
    const second = requireSuccess(service.createExecutor(editor))
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
    await installCapabilities(
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
    const executor = requireSuccess(
      registry.required(executorsService).createExecutor(openEditor('notes.MD'))
    )
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
    await installCapabilities(first)
    const executor = requireSuccess(
      registry.required(executorsService).createExecutor(openEditor())
    )
    expect(executor.output.value.get(first)).toBeUndefined()
    await settled(executor)
    const original = executor.output.value
    expect(original.get(first)?.html).toBe('original')
    expect(original.get(replacement)).toBeUndefined()
    await installCapabilities(replacement)
    expect(executor.output.value.get(first)).toBeUndefined()
    await settled(executor)
    expect(executor.output.value.get(replacement)?.count).toBe(8)
    expect(executor.output.value.get(first)).toBeUndefined()
    expect(original.get(first)?.html).toBe('original')
    await installCapabilities()
    expect(executor.output.value.get(replacement)).toBeUndefined()
  })

  it('collects returned errors, thrown errors and rejected promises without losing successful data', async () => {
    const returned = new Error('returned')
    const thrown = new Error('thrown')
    await installCapabilities(
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
    const executor = requireSuccess(
      registry.required(executorsService).createExecutor(openEditor())
    )
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
    await installCapabilities({ id: 'echo', matches: '*', execute })
    const editor = openEditor()
    const executor = requireSuccess(
      registry.required(executorsService).createExecutor(editor)
    )
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
    await installCapabilities({ id: 'echo', matches: '*', execute })
    const editor = openEditor()
    const executor = requireSuccess(
      registry.required(executorsService).createExecutor(editor)
    )
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    edit(editor, 'latest')
    await settled(executor)
    const latest = executor.output.value
    old.resolve({ contents: 'stale' })
    await old.promise
    // Let `old.promise` continuations run before checking that they cannot
    // overwrite the already-published `latest` output.
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
    await installCapabilities(
      { id: 'markdown', matches: '.md', execute: markdown },
      { id: 'kcl', matches: '.kcl', execute: kcl }
    )
    const editor = openEditor()
    const executor = requireSuccess(
      registry.required(executorsService).createExecutor(editor)
    )
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
    await installCapabilities(
      { id: 'slow', matches: '*', execute: () => slow.promise },
      { id: 'fast', matches: '*', execute: () => ({ ready: true }) }
    )
    const executor = requireSuccess(
      registry.required(executorsService).createExecutor(openEditor())
    )
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
    await installCapabilities({
      id: 'echo',
      matches: '*',
      execute: (contents) => ({ contents }),
    })
    const first = openEditor('shared.md', 'first')
    const second = openEditor('shared.md', 'second')
    const service = registry.required(executorsService)
    const firstExecutor = requireSuccess(service.createExecutor(first))
    const secondExecutor = requireSuccess(service.createExecutor(second))
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
    await installCapabilities({ id: 'removed', matches: '*', execute })
    const executor = requireSuccess(
      registry.required(executorsService).createExecutor(openEditor())
    )
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    await installCapabilities()
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
    await installCapabilities(capability)
    const executor = requireSuccess(
      registry.required(executorsService).createExecutor(openEditor())
    )
    await settled(executor)
    await installCapabilities(capability, {
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
    await installCapabilities(replacement)
    await settled(executor)
    expect(executor.output.value.data).toEqual({ markdown: { replaced: true } })
    await installCapabilities()
    await settled(executor)
    expect(executor.output.value.data).toEqual({})
  })

  it.each(['close', 'destroy editor', 'dispose registry'] as const)(
    'stops watchers and discards pending results on %s',
    async (action) => {
      const pending = deferred<Record<string, unknown>>()
      const execute = vi.fn(() => pending.promise)
      await installCapabilities({ id: 'pending', matches: '*', execute })
      const editor = openEditor()
      const service = registry.required(executorsService)
      const executor = requireSuccess(service.createExecutor(editor))
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
      if (action === 'close') service.closeExecutor(executor.id)
      if (action === 'destroy editor') editor.close()
      if (action === 'dispose registry') await registry.dispose()
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
