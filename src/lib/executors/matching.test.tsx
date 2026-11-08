import '@src/lib/projectSession/next/testFeature'
import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorLanguageValueSpec,
} from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  defineExecutorCapability,
  executorCapabilityValueSpec,
  executorsService,
} from '@src/lib/executors/registry/contract'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
let registry: Registry | undefined
afterEach(() => {
  cleanup()
  registry?.[Symbol.dispose]()
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
  registry.configure([
    editorsExtension,
    executorsExtension,
    defineRegistryItem({
      provides: [provide(executorCapabilityValueSpec, capability)],
    }),
  ])
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/project/settings.toml', 'disabled')
  const executor = registry.get(executorsService).createExecutor(editor)
  expect(executor.output.value.running).toBe(false)
  editor.view.dispatch({
    changes: { from: 0, to: editor.view.state.doc.length, insert: 'enabled' },
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
  editor.view.dispatch({
    changes: { from: 0, to: editor.view.state.doc.length, insert: 'disabled' },
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
  registry.configure([
    editorsExtension,
    executorsExtension,
    defineRegistryItem({
      provides: [
        provide(editorLanguageValueSpec, {
          id: 'markdown',
          matches: '.md',
          mediaType: 'text/markdown',
        }),
        provide(executorCapabilityValueSpec, capability),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const editor = editors.createEditor('draft')
  const executor = registry.get(executorsService).createExecutor(editor)
  expect(executor.output.value.get(capability)).toBeUndefined()
  editors.setLanguage(editor.id, 'markdown')
  await vi.waitFor(() =>
    expect(executor.output.value.get(capability)).toEqual({ rendered: 'DRAFT' })
  )
  editors.setLanguage(editor.id, undefined)
  expect(executor.output.value.get(capability)).toBeUndefined()
  expect(editor.src.value).toBeUndefined()
})
