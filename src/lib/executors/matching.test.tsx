import '@src/lib/projectSession/next/testFeature'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { act, cleanup, render, screen } from '@testing-library/react'
import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorsService,
  executorCapabilityValueSpec,
  executorViewValueSpec,
  defineExecutorCapability,
} from '@src/lib/executors/registry/contract'
import { OPEN_EXECUTOR_COMMAND } from '@src/lib/executors/commands'
import { ExecutorView } from '@src/lib/executors/ExecutorView'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import projectExtension from '@src/lib/projectSession/registry'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

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

it('keeps empty-result modes available and updates predicate views from the live buffer', async () => {
  registry = new Registry()
  registry.configure([
    editorsExtension,
    executorsExtension,
    defineRegistryItem({
      provides: [
        provide(executorCapabilityValueSpec, {
          id: 'render',
          matches: '*',
          execute: () => ({ sheets: [] }),
        }),
        provide(executorViewValueSpec, {
          id: 'drawings',
          label: 'Drawings',
          capabilityId: 'render',
          matches: '.kcl',
          Component: () => <p>No drawings yet</p>,
        }),
        provide(executorViewValueSpec, {
          id: 'settings',
          label: 'Settings',
          capabilityId: 'render',
          matches: ({ src, contents }) =>
            fsZds.basename(src) === 'settings.toml' &&
            contents.startsWith('enabled'),
          Component: () => <p>Settings form</p>,
        }),
      ],
    }),
  ])
  const editors = registry.get(editorsService),
    executors = registry.get(executorsService)
  const editor = editors.openEditor('/project/main.kcl', '')
  const tab = executors.openView(editor, 'drawings')
  render(
    <ExecutorView
      executors={executors}
      capabilities={registry.signal(executorCapabilityValueSpec)}
      views={registry.signal(executorViewValueSpec)}
      onOpenExecutor={() => {}}
    />
  )
  expect(screen.getByText('No drawings yet')).toBeVisible()
  await act(async () => {
    editors.setSource(editor.id, '/project/settings.toml')
    editor.view.dispatch({ changes: { from: 0, insert: 'enabled = true' } })
    executors.setView(tab.executor.id, 'settings')
  })
  expect(screen.getByText('Settings form')).toBeVisible()
  await act(async () => {
    editor.view.dispatch({
      changes: {
        from: 0,
        to: editor.view.state.doc.length,
        insert: 'disabled',
      },
    })
  })
  expect(screen.queryByText('Settings form')).not.toBeInTheDocument()
  expect(executors.viewTabs.value[0].executor).toBe(tab.executor)
})

it.each([true, false])(
  'checks the selected unopened file before offering content-specific modes: %s',
  async (enabled) => {
    const readFile = vi.fn(async () =>
      new TextEncoder().encode(enabled ? 'enabled = true' : 'disabled')
    )
    registry = new Registry()
    registry.configure([
      editorsExtension,
      executorsExtension,
      projectExtension,
      defineRegistryItem({
        providesServices: [
          provideService(fileOperationsService, {
            ...testFileOperations,
            readFile,
          }),
        ],
        provides: [
          provide(executorCapabilityValueSpec, {
            id: 'settings',
            matches: ({ src, contents }) =>
              fsZds.basename(src) === 'settings.toml' &&
              contents.startsWith('enabled'),
            execute: () => ({}),
          }),
          provide(executorViewValueSpec, {
            id: 'settings',
            label: 'Settings',
            capabilityId: 'settings',
            matches: '*',
            Component: () => null,
          }),
        ],
      }),
    ])
    registry.get(projectSessionService).openProject({
      contents: {
        name: 'project',
        path: '/project',
        children: [
          {
            name: 'settings.toml',
            path: '/project/settings.toml',
            children: null,
          },
        ],
      },
      metadata: { title: 'Project', readWriteAccess: true },
    })
    const command = registry
      .get(commandsValueSpec)
      .find(({ id }) => id === OPEN_EXECUTOR_COMMAND.id)!
    const src = command.args!.src
    if (src.inputType !== 'options' || !src.validation)
      expect.unreachable('Expected source validation')
    expect(readFile).not.toHaveBeenCalled()
    expect(
      await src.validation({
        data: { src: '/project/settings.toml' },
        context: {} as CommandBarContext,
      })
    ).toBe(enabled || 'No executor view matches this file')
    expect(registry.get(editorsService).editors.value).toEqual([])
    if (!enabled) {
      expect(
        await command.onSubmit?.({
          src: '/project/settings.toml',
          view: 'settings',
        })
      ).toBeInstanceOf(Error)
      expect(registry.get(editorsService).editors.value).toEqual([])
      expect(registry.get(executorsService).viewTabs.value).toEqual([])
      return
    }
    const tab = await command.onSubmit?.({
      src: '/project/settings.toml',
      view: 'settings',
    })
    expect(tab).not.toBeInstanceOf(Error)
    expect(registry.get(executorsService).viewTabs.value).toHaveLength(1)
    const other = registry.get(editorsService).editors.value[0]
    other.view.dispatch({
      changes: { from: 0, to: other.view.state.doc.length, insert: 'disabled' },
    })
    expect(
      await command.onSubmit?.({
        src: '/project/settings.toml',
        view: 'settings',
      })
    ).toBeInstanceOf(Error)
    expect(registry.get(executorsService).viewTabs.value).toHaveLength(1)
  }
)
