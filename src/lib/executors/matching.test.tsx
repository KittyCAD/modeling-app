import { requireSuccess } from '@src/lib/editors/testViews'
import '@src/lib/projectSession/next/testFeature'
import { contribute, Registry } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorLanguagesFacet,
} from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  defineExecutorCapability,
  executorCapabilityFacet,
  executorsService,
} from '@src/lib/executors/registry/contract'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
let registry: Registry | undefined
afterEach(async () => {
  cleanup()
  await registry?.dispose()
})
vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))

it('interrupts a run when its contents stop matching and rematches on same-type renames', async () => {
  let finish!: (data: { ready: boolean }) => void
  let aborted: AbortSignal | undefined
  const execute = vi.fn(
    (_contents: string, context: { signal: AbortSignal }) => {
      aborted = context.signal
      return new Promise<{ ready: boolean }>((resolve) => {
        finish = resolve
      })
    }
  )
  const capability = defineExecutorCapability({
    id: 'settings',
    matches: ({ src, contents }) =>
      fsZds.basename(src) === 'settings.toml' && contents === 'enabled',
    execute,
  })
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    [contribute(executorCapabilityFacet, () => capability)],
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(
    editors.openEditor('/project/settings.toml', 'disabled')
  )
  const executor = requireSuccess(
    registry.required(executorsService).createExecutor(editor)
  )
  expect(executor.output.value.running).toBe(false)
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: 'enabled' },
  })
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
  editors.setSource(editor.id, '/project/other.toml')
  expect(executor.output.value.running).toBe(false)
  finish({ ready: true })
  await vi.waitFor(() => expect(aborted?.aborted).toBe(true))
  expect(executor.output.value.get(capability)).toBeUndefined()
  expect(executor.output.value.running).toBe(false)
  editors.setSource(editor.id, '/project/settings.toml')
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: 'disabled' },
  })
  expect(executor.output.value.running).toBe(false)
  finish({ ready: true })
  await vi.waitFor(() => expect(aborted?.aborted).toBe(true))
  expect(executor.output.value.get(capability)).toBeUndefined()
})

it('rematches an unnamed editor when its language is chosen and cleared', async () => {
  const capability = defineExecutorCapability({
    id: 'markdown-format',
    matches: ({ mediaType }) => mediaType === 'text/markdown',
    execute: (contents) => ({ rendered: contents.toUpperCase() }),
  })
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    [
      contribute(editorLanguagesFacet, () => ({
        id: 'markdown',
        matches: '.md' as const,
        mediaType: 'text/markdown',
      })),
      contribute(executorCapabilityFacet, () => capability),
    ],
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.createEditor('draft'))
  const executor = requireSuccess(
    registry.required(executorsService).createExecutor(editor)
  )
  expect(executor.output.value.get(capability)).toBeUndefined()
  editors.setLanguage(editor.id, 'markdown')
  await vi.waitFor(() =>
    expect(executor.output.value.get(capability)).toEqual({ rendered: 'DRAFT' })
  )
  editors.setLanguage(editor.id, undefined)
  expect(executor.output.value.get(capability)).toBeUndefined()
  expect(editor.src.value).toBeUndefined()
})

it('runs only requested nonmatching capabilities for unnamed buffers and shares their leases', async () => {
  const renderMarkdown = vi.fn((contents: string) => ({ text: contents }))
  const renderKcl = vi.fn((contents: string) => ({ text: contents }))
  const markdown = defineExecutorCapability({
    id: 'markdown',
    matches: '.md',
    execute: renderMarkdown,
  })
  const kcl = defineExecutorCapability({
    id: 'kcl',
    matches: '.kcl',
    execute: renderKcl,
  })
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    contribute(executorCapabilityFacet, () => markdown),
    contribute(executorCapabilityFacet, () => kcl),
  ])
  const editors = registry.required(editorsService)
  const executors = registry.required(executorsService)
  const editor = requireSuccess(editors.createEditor('draft'))
  const keeper = requireSuccess(executors.acquireExecutor(editor))
  const first = requireSuccess(executors.acquireExecutor(editor, markdown))
  const second = requireSuccess(executors.acquireExecutor(editor, markdown))
  expect(first.executor).toBe(keeper.executor)
  expect(second.executor).toBe(keeper.executor)
  await vi.waitFor(() =>
    expect(first.executor.output.peek().get(markdown)?.text).toBe('draft')
  )
  expect(renderKcl).not.toHaveBeenCalled()
  first.release()
  editor.dispatch({ changes: { from: 0, insert: 'edited ' } })
  await vi.waitFor(() =>
    expect(second.executor.output.peek().get(markdown)?.text).toBe(
      'edited draft'
    )
  )
  second.release()
  await vi.waitFor(() =>
    expect(keeper.executor.output.peek().get(markdown)).toBeUndefined()
  )
  const kclLease = requireSuccess(executors.acquireExecutor(editor, kcl))
  await vi.waitFor(() =>
    expect(kclLease.executor.output.peek().get(kcl)?.text).toBe('edited draft')
  )
  requireSuccess(editors.setSource(editor.id, '/project/notes.md'))
  await vi.waitFor(() =>
    expect(keeper.executor.output.peek().get(markdown)?.text).toBe(
      'edited draft'
    )
  )
  expect(keeper.executor.output.peek().get(kcl)).toBeUndefined()
  keeper.release()
  kclLease.release()
  expect(executors.executors.peek()).toEqual([])
})

it('interrupts an unnamed-mode computation when its last request is released', async () => {
  let finish!: (result: { text: string }) => void
  let running: AbortSignal | undefined
  const execute = vi.fn(
    (_contents: string, { signal }: { signal: AbortSignal }) => {
      running = signal
      return new Promise<{ text: string }>((resolve) => {
        finish = resolve
      })
    }
  )
  const capability = defineExecutorCapability({
    id: 'markdown',
    matches: '.md',
    execute,
  })
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    contribute(executorCapabilityFacet, () => capability),
  ])
  const editor = requireSuccess(
    registry.required(editorsService).createEditor('draft')
  )
  const executors = registry.required(executorsService)
  const keeper = requireSuccess(executors.acquireExecutor(editor))
  const requested = requireSuccess(
    executors.acquireExecutor(editor, capability)
  )
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
  requested.release()
  await vi.waitFor(() => expect(running?.aborted).toBe(true))
  finish({ text: 'stale result' })
  await vi.waitFor(() =>
    expect(keeper.executor.output.peek().running).toBe(false)
  )
  expect(keeper.executor.output.peek().get(capability)).toBeUndefined()
  keeper.release()
})
