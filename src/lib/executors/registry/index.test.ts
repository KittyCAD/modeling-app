import '@src/lib/projectSession/next/testFeature'
import { signal } from '@preact/signals-core'
import { contribute, Registry, slot } from 'plankton'
import { createEditorDocument } from '@src/lib/editors/document'
import { requireSuccess } from '@src/lib/editors/testViews'
import executorsExtension from '@src/lib/executors/registry'
import {
  defineExecutorCapability,
  executorCapabilityFacet,
  executorsService,
  type ExecutorCapability,
} from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

let registry: Registry
let capabilities: ReturnType<typeof slot>
let cleanup: (() => void)[]
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(async () => {
  registry = new Registry()
  capabilities = slot([])
  cleanup = []
  await registry.configure([executorsExtension, capabilities])
})
afterEach(async () => {
  await registry.dispose()
  cleanup.forEach((dispose) => dispose())
})
function openEditor(contents = 'original') {
  const backing = createEditorDocument(contents)
  cleanup.push(backing.dispose)
  const editor = {
    ...backing.document,
    get state() {
      return backing.document.state
    },
    id: Symbol(),
    src: signal('notes.md'),
    classification: signal(undefined),
    readOnly: signal(false),
  }
  return {
    editor,
    close: backing.dispose,
    edit: (text: string) =>
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
      }),
  }
}
const install = (...values: ExecutorCapability[]) =>
  registry.replace(
    capabilities,
    values.map((capability) =>
      contribute(executorCapabilityFacet, () => capability)
    )
  )
const create = (editor: ReturnType<typeof openEditor>['editor']) =>
  requireSuccess(registry.required(executorsService).createExecutor(editor))

it('does no work until requested, retaining completed data when text or dependencies change', async () => {
  const revision = signal(1)
  const execute = vi.fn((contents: string) => ({
    contents,
    dependency: revision.peek(),
  }))
  const capability = defineExecutorCapability({
    id: 'analysis',
    matches: '*',
    revision,
    execute,
  })
  await install(capability)
  const source = openEditor()
  const executor = create(source.editor)
  expect(executor.result(capability).value).toMatchObject({
    running: false,
    stale: true,
    data: undefined,
  })
  expect(execute).not.toHaveBeenCalled()
  await executor.run(capability)
  expect(executor.result(capability).value).toMatchObject({
    running: false,
    stale: false,
    data: { contents: 'original', dependency: 1 },
  })
  source.edit('changed')
  revision.value = 2
  expect(executor.result(capability).value).toMatchObject({
    stale: true,
    data: { contents: 'original', dependency: 1 },
  })
  expect(execute).toHaveBeenCalledOnce()
  await executor.run(capability)
  expect(executor.result(capability).value).toMatchObject({
    stale: false,
    data: { contents: 'changed', dependency: 2 },
  })
})

it('lets a requested run finish against captured inputs after edits and renames', async () => {
  const pending = Promise.withResolvers<{ contents: string }>()
  let captured: { src: string; signal: AbortSignal } | undefined
  const capability = defineExecutorCapability({
    id: 'analysis',
    matches: '*',
    execute: (_contents, context) => {
      captured = context
      return pending.promise
    },
  })
  await install(capability)
  const source = openEditor()
  const executor = create(source.editor)
  const run = executor.run(capability)
  source.edit('newer')
  source.editor.src.value = 'renamed.kcl'
  expect(captured?.signal.aborted).toBe(false)
  expect(captured?.src).toBe('notes.md')
  pending.resolve({ contents: 'original' })
  await run
  expect(executor.result(capability).value).toMatchObject({
    stale: true,
    running: false,
    input: { src: 'notes.md', contents: 'original' },
    data: { contents: 'original' },
  })
})

it('supersedes only the requested capability and ignores late replies', async () => {
  const first = Promise.withResolvers<{ text: string }>()
  const second = Promise.withResolvers<{ text: string }>()
  const contexts: AbortSignal[] = []
  const analysis = defineExecutorCapability({
    id: 'analysis',
    matches: '*',
    execute: (_contents, context) => {
      contexts.push(context.signal)
      return contexts.length === 1 ? first.promise : second.promise
    },
  })
  const preview = defineExecutorCapability({
    id: 'preview',
    matches: '*',
    execute: (text) => ({ html: text }),
  })
  await install(analysis, preview)
  const executor = create(openEditor().editor)
  await executor.run(preview)
  const retained = executor.result(preview).value
  const old = executor.run(analysis)
  const latest = executor.run(analysis)
  expect(contexts[0].aborted).toBe(true)
  expect(contexts[1].aborted).toBe(false)
  expect(executor.result(preview).value).toEqual(retained)
  second.resolve({ text: 'latest' })
  await latest
  first.resolve({ text: 'obsolete' })
  await old
  expect(executor.output.value.get(analysis)).toEqual({ text: 'latest' })
  expect(executor.output.value.get(preview)).toEqual({ html: 'original' })
})

it('retains previous data while its replacement runs', async () => {
  const pending = Promise.withResolvers<{ text: string }>()
  let initial = true
  const capability = defineExecutorCapability({
    id: 'analysis',
    matches: '*',
    execute: () => (initial ? { text: 'first' } : pending.promise),
  })
  await install(capability)
  const source = openEditor()
  const executor = create(source.editor)
  await executor.run(capability)
  initial = false
  source.edit('second')
  const run = executor.run(capability)
  expect(executor.result(capability).value).toMatchObject({
    running: true,
    stale: true,
    data: { text: 'first' },
  })
  pending.resolve({ text: 'second' })
  await run
  expect(executor.result(capability).value).toMatchObject({
    running: false,
    stale: false,
    data: { text: 'second' },
  })
})

it('keeps failures separate and permits retrying unchanged input', async () => {
  const failed = new Error('failed')
  const capability = defineExecutorCapability({
    id: 'failure',
    matches: '*',
    execute: vi
      .fn()
      .mockRejectedValueOnce(failed)
      .mockReturnValue({ ok: true }),
  })
  const success = defineExecutorCapability({
    id: 'success',
    matches: '*',
    execute: () => ({ ok: true }),
  })
  await install(capability, success)
  const executor = create(openEditor().editor)
  await Promise.all([executor.run(capability), executor.run(success)])
  expect(executor.output.value.errors.failure).toBe(failed)
  expect(executor.output.value.get(success)).toEqual({ ok: true })
  await executor.run(capability)
  expect(executor.output.value.errors).toEqual({})
  expect(executor.result(capability).value.stale).toBe(false)
})

it('withdraws a capability and cancels its work without confusing a replacement with the same ID', async () => {
  const pending = Promise.withResolvers<{ html: string }>()
  let signal: AbortSignal | undefined
  const first = defineExecutorCapability({
    id: 'preview',
    matches: '*',
    execute: (_text, context) => {
      signal = context.signal
      return pending.promise
    },
  })
  const replacement = defineExecutorCapability({
    id: 'preview',
    matches: '*',
    execute: () => ({ count: 42 }),
  })
  await install(first)
  const executor = create(openEditor().editor)
  const run = executor.run(first)
  await install(replacement)
  expect(signal?.aborted).toBe(true)
  await executor.run(replacement)
  pending.resolve({ html: 'obsolete' })
  await run
  expect(executor.output.value.get(first)).toBeUndefined()
  expect(executor.output.value.get(replacement)).toEqual({ count: 42 })
})

it('shares leased executors but leaves explicitly created ones independent', async () => {
  const capability = defineExecutorCapability({
    id: 'echo',
    matches: '*',
    execute: (text) => ({ text }),
  })
  await install(capability)
  const source = openEditor()
  const service = registry.required(executorsService)
  const first = requireSuccess(service.acquireExecutor(source.editor))
  const second = requireSuccess(service.acquireExecutor(source.editor))
  const independent = create(source.editor)
  expect(first.executor).toBe(second.executor)
  await independent.run(capability)
  expect(first.executor.output.value.get(capability)).toBeUndefined()
  first.release()
  expect(service.executors.value).toContain(second.executor)
  second.release()
  expect(service.executors.value).toEqual([independent])
  source.close()
  expect(service.executors.value).toEqual([])
})

it.each(['createExecutor', 'acquireExecutor'] as const)(
  'rejects %s for a closed editor',
  (method) => {
    const source = openEditor()
    source.close()
    expect(registry.required(executorsService)[method](source.editor)).toEqual(
      new Error('The editor is closed')
    )
    expect(registry.required(executorsService).executors.value).toEqual([])
  }
)

it.each(['executor', 'editor', 'registry'])(
  'cancels requested work when its %s closes',
  async (owner) => {
    const pending = Promise.withResolvers<{ ready: boolean }>()
    let signal: AbortSignal | undefined
    const capability = defineExecutorCapability({
      id: 'pending',
      matches: '*',
      execute: (_text, context) => {
        signal = context.signal
        return pending.promise
      },
    })
    await install(capability)
    const source = openEditor()
    const executor = create(source.editor)
    const run = executor.run(capability)
    if (owner === 'executor')
      registry.required(executorsService).closeExecutor(executor.id)
    if (owner === 'editor') source.close()
    if (owner === 'registry') await registry.dispose()
    expect(signal?.aborted).toBe(true)
    const output = executor.output.value
    pending.resolve({ ready: true })
    await run
    expect(executor.output.value).toBe(output)
    await executor.run(capability)
    expect(executor.output.value.get(capability)).toBeUndefined()
  }
)
