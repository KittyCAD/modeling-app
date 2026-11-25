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

it('retains a requested run when its editor stops matching and only executes again on request', async () => {
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
  const firstRun = executor.run(capability)
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
  editors.setSource(editor.id, '/project/other.toml')
  expect(executor.output.value.running).toBe(true)
  finish({ ready: true })
  await firstRun
  expect(aborted?.aborted).toBe(false)
  expect(executor.result(capability).value).toMatchObject({
    stale: true,
    data: { ready: true },
  })
  expect(executor.output.value.running).toBe(false)
  editors.setSource(editor.id, '/project/settings.toml')
  const secondRun = executor.run(capability)
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: 'disabled' },
  })
  expect(executor.output.value.running).toBe(true)
  finish({ ready: true })
  await secondRun
  expect(aborted?.aborted).toBe(false)
  expect(executor.result(capability).value.stale).toBe(true)
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
  await executor.run(capability)
  await vi.waitFor(() =>
    expect(executor.output.value.get(capability)).toEqual({ rendered: 'DRAFT' })
  )
  editors.setLanguage(editor.id, undefined)
  expect(executor.result(capability).value.stale).toBe(true)
  expect(executor.output.value.get(capability)).toEqual({ rendered: 'DRAFT' })
  expect(editor.src.value).toBeUndefined()
})
