import { createActor } from 'xstate'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { MachineManager } from '@src/lib/MachineManager'
import { createContextualCommands } from '@src/lib/commands/contextual'
import {
  commandSystemService,
  contextualCommandsService,
} from '@src/registry/contracts/commands'
import {
  keymapService,
  createKeymapTree,
  createEmptyPersistedKeymap,
} from '@src/registry/contracts/keymap'
import { userFeaturesExtension } from '@src/registry/extensions/userFeatures'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { signal } from '@preact/signals-core'
import '@src/lib/projectSession/next/testFeature'
import { factory, contribute, provide, Registry } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorTabIndicatorsFacet,
} from '@src/lib/editors/registry/contract'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import { LayoutType } from '@src/lib/layout/types'
import { commandsFacet } from '@src/registry/contracts/commands'
import { KCL_RENDER_COMMAND } from '@src/lib/kcl/registry/renderCommands'
import { requireSuccess } from '@src/lib/editors/testViews'
import executorsExtension from '@src/lib/executors/registry'
import { executorsService } from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import kclExtension from '@src/lib/kcl/registry'
import { kclExecutionSettingsService } from '@src/lib/kcl/scene/executionSettingsContract'
import type { KclSceneResource } from '@src/lib/kcl/scene/open'
import { openKclScene } from '@src/lib/kcl/scene/open'
import { initialiseWasm } from '@src/lang/wasmUtils'
import {
  readKclFileExtensions,
  readKclVersion,
} from '@src/lib/kcl/execution/nativeInputs'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseFacet } from '@src/registry/contracts/wasm'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import {
  createTestKclScene,
  createTestSettings,
} from '@src/lib/kcl/testFixtures'

const testKeymap = factory({
  create: () => ({
    items: [
      provide(keymapService, {
        keymap: signal(createKeymapTree([])),
        persistedKeymap: signal(createEmptyPersistedKeymap()),
        partialMatch: signal(false),
        applyScope: () => {},
        removeScope: () => {},
        getCurrentScopes: () => [],
        savePersistedKeymap: async () => {},
        addUserBinding: async () => {},
        removeUserBinding: async () => {},
        unbind: async () => {},
        suspendListening: () => () => {},
        handleKeyDown: () => false,
        focusScope: () => ({ onFocus: () => {}, onBlur: () => {} }),
      }),
    ],
  }),
})

// Registry tests exercise source capture and scene ownership. Tool dispatch uses
// the real command extension in machine/host.spec.tsx, where native code is available.
const testCommands = factory({
  create: () => {
    const actor = createActor(commandBarMachine, {
      input: {
        commands: [],
        machineManager: new MachineManager(),
        wasmInstancePromise: new Promise<ModuleType>(() => {}),
      },
    })
    const contextual = createContextualCommands()
    return {
      items: [
        provide(commandSystemService, {
          actor,
          send: (event) => actor.send(event),
          useState: () => actor.getSnapshot(),
        }),
        provide(contextualCommandsService, contextual),
      ],
      dispose: () => {
        actor.stop()
        contextual.dispose()
      },
    }
  },
})

// This suite checks registry/executor ownership. The real machine/native boundary is exercised by machine/host.spec.tsx.
vi.mock('@src/lib/kcl/machine/host', () => ({
  createMachineModelingHost: () => ({
    owner: signal(undefined),
    error: signal(undefined),
    enter: async () => {},
    dispose: async () => {},
    closeDialog: () => {},
  }),
}))
vi.mock('@src/clientSideScene/localRenderer/LocalWebGPUSceneView', () => ({
  LocalWebGPUSceneView: () => null,
}))
vi.mock('@src/lib/kcl/scene/open', () => ({ openKclScene: vi.fn() }))
vi.mock('@src/lib/kcl/execution/nativeInputs', () => ({
  readKclVersion: vi.fn(async () => '3.0'),
  readKclFileExtensions: vi.fn(async () => ['kcl']),
}))
vi.mock('@src/lang/wasmUtils', () => ({
  initialiseWasm: vi.fn(() => new Promise<ModuleType>(() => {})),
}))
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
afterEach(() => vi.restoreAllMocks())
it.each([false, true])(
  'binds classified buffers to independent Modeling scenes (local rendering: %s)',
  async (local) => {
    vi.mocked(openKclScene).mockClear()
    vi.mocked(readKclFileExtensions).mockClear()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
    const resources: KclSceneResource[] = []
    vi.mocked(openKclScene).mockImplementation(
      async ({ preferences, presentation }) => {
        const resource = createTestKclScene(presentation, { preferences })

        resources.push(resource)
        return resource
      }
    )
    const settingsProvider = createTestSettings()
    const settings = settingsProvider.current.peek()
    settings.modeling.highlightEdges.user = false
    settings.modeling.useLocalRenderer.user = local
    const wasm = new Promise<ModuleType>(() => {})
    const registry = new Registry()
    await registry.configure([
      testCommands,
      testKeymap,
      userFeaturesExtension,
      editorsExtension,
      executorsExtension,
      kclExtension,
      provide(fileOperationsService, testFileOperations),
      [
        [provide(settingsService, settingsProvider)],
        [contribute(wasmPromiseFacet, () => wasm)],
      ],
    ])
    try {
      const editors = registry.required(editorsService)
      const editor = requireSuccess(
        editors.createEditor('@settings(kclVersion = 3.0)\nanswer = 42')
      )
      requireSuccess(editors.setLanguage(editor.id, 'kcl'))
      const first = requireSuccess(editors.createView(editor, 'kcl.modeling'))
      const second = requireSuccess(editors.createView(editor, 'kcl.modeling'))
      await vi.waitFor(() =>
        expect(editors.viewState(first).peek().binding.type).toBe('ready')
      )
      expect(registry.required(executorsService).executors.peek()).toHaveLength(
        1
      )
      const a = editors.viewState(first).peek().binding
      const b = editors.viewState(second).peek().binding
      if (a.type !== 'ready' || b.type !== 'ready')
        return expect.fail('Modeling did not bind')
      const mounted = render(
        <>
          <a.Component editor={editor} instance={first} active />
          <b.Component editor={editor} instance={second} active />
        </>
      )
      await vi.waitFor(() => expect(resources).toHaveLength(2))
      expect(
        await screen.findAllByRole('contentinfo', {
          name: 'Modeling view status',
        })
      ).toHaveLength(2)
      const nativeSettings = registry.required(kclExecutionSettingsService)
      for (const [options] of vi.mocked(openKclScene).mock.calls) {
        expect(options.wasm).toBe(wasm)
        expect(options.nativeSettings.executeRevision.peek()).toBe(
          nativeSettings.executeRevision.peek()
        )
        expect(options.nativeSettings.configuration.peek()).toEqual(
          nativeSettings.configuration.peek()
        )
      }
      await vi.waitFor(() =>
        expect(
          registry
            .required(executorsService)
            .executors.peek()
            .every((executor) => !executor.output.peek().running)
        ).toBe(true)
      )
      await vi.waitFor(() => {
        for (const resource of resources)
          expect(resource.runtime.execute).toHaveBeenCalledOnce()
      })
      const sharedExecutor = registry
        .required(executorsService)
        .executors.peek()[0]
      expect(resources[0].runtime).not.toBe(resources[1].runtime)
      expect(vi.mocked(resources[0].runtime.execute).mock.calls[0][0]).toBe(
        vi.mocked(resources[1].runtime.execute).mock.calls[0][0]
      )
      expect(readKclFileExtensions).toHaveBeenCalledOnce()
      expect(
        resources.every(
          (resource) => resource.presentation === (local ? 'local' : 'streamed')
        )
      ).toBe(true)
      expect(
        resources.every(
          (resource) =>
            vi.mocked(resource.runtime.execute).mock.calls[0][0].src ===
            'main.kcl'
        )
      ).toBe(true)
      const changes = [
        () => {
          settings.modeling.highlightEdges.user = true
        },
        () => {
          settings.modeling.showScaleGrid.user = true
        },
        () => {
          settings.modeling.fixedSizeGrid.user = false
        },
        () => {
          settings.modeling.defaultUnit.user = 'in'
        },
      ]
      let executions = 1
      for (const change of changes) {
        await act(async () => {
          change()
        })
        executions++
        await vi.waitFor(() => {
          for (const resource of resources)
            expect(resource.runtime.execute).toHaveBeenCalledTimes(executions)
        })
      }
      await act(async () => {
        settings.modeling.backfaceColor.user = '#123456'
      })
      if (!local) executions++
      await vi.waitFor(() => {
        for (const resource of resources)
          expect(resource.runtime.execute).toHaveBeenCalledTimes(executions)
      })
      for (const resource of resources) {
        const runs = vi.mocked(resource.runtime.execute).mock.calls
        expect(runs.at(-1)?.[0]).toEqual(runs[0][0])
      }
      await act(async () => {
        settings.modeling.useLocalRenderer.user = local
      })
      await vi.waitFor(() =>
        expect(
          registry
            .required(executorsService)
            .executors.peek()
            .every((executor) => !executor.output.peek().running)
        ).toBe(true)
      )
      for (const resource of resources)
        expect(resource.runtime.execute).toHaveBeenCalledTimes(executions)
      await act(async () => {
        settings.modeling.backfaceColor.user = '#abcdef'
      })
      if (!local) executions++
      await vi.waitFor(() => {
        for (const resource of resources)
          expect(resource.runtime.execute).toHaveBeenCalledTimes(executions)
      })
      const existing = [...resources]
      const third = requireSuccess(editors.createView(editor, 'kcl.modeling'))
      await vi.waitFor(() =>
        expect(editors.viewState(third).peek().binding.type).toBe('ready')
      )
      const next = editors.viewState(third).peek().binding
      if (next.type !== 'ready')
        return expect.fail('New Modeling view did not bind')
      const thirdMounted = render(
        <next.Component editor={editor} instance={third} active />
      )
      await vi.waitFor(() => expect(resources).toHaveLength(3))
      const fresh = resources[2]
      expect(fresh.presentation).toBe(local ? 'local' : 'streamed')
      expect(registry.required(executorsService).executors.peek()).toEqual([
        sharedExecutor,
      ])
      await vi.waitFor(() =>
        expect(fresh.runtime.execute).toHaveBeenCalledOnce()
      )
      await act(async () => {
        settings.modeling.backfaceColor.user = '#fedcba'
      })
      if (!local) executions++
      await vi.waitFor(() => {
        for (const resource of existing)
          expect(resource.runtime.execute).toHaveBeenCalledTimes(executions)
        expect(fresh.runtime.execute).toHaveBeenCalledTimes(local ? 1 : 2)
      })
      thirdMounted.unmount()
      mounted.unmount()
      expect(resources[0].dispose).not.toHaveBeenCalled()
      await act(async () => {
        requireSuccess(editors.closeView(first.id))
      })
      await vi.waitFor(() =>
        expect(resources[0].dispose).toHaveBeenCalledOnce()
      )
      expect(resources[1].dispose).not.toHaveBeenCalled()
      expect(registry.required(executorsService).executors.peek()).toEqual([
        sharedExecutor,
      ])
      expect(readKclFileExtensions).toHaveBeenCalledOnce()
      const remainingRuns = vi.mocked(resources[1].runtime.execute).mock.calls
        .length
      await act(async () => {
        editor.dispatch({
          changes: {
            from: editor.contents.peek().length,
            insert: '\nanswer2 = 7',
          },
        })
      })
      await vi.waitFor(() =>
        expect(resources[1].runtime.execute).toHaveBeenCalledTimes(
          remainingRuns + 1
        )
      )
      expect(resources[0].runtime.execute).toHaveBeenCalledTimes(executions)
      expect(readKclFileExtensions).toHaveBeenCalledTimes(2)
      await act(async () => {
        requireSuccess(editors.closeEditor(editor.id))
      })
      await vi.waitFor(() =>
        expect(resources[1].dispose).toHaveBeenCalledOnce()
      )
      expect(registry.required(executorsService).executors.peek()).toEqual([])
    } finally {
      await registry.dispose()
    }
  }
)

it.each([false, true])(
  'reports a missing WASM provider instead of initializing one (local rendering: %s)',
  async (local) => {
    vi.clearAllMocks()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
    vi.mocked(readKclFileExtensions).mockImplementationOnce(async (wasm) => {
      await wasm
      return ['kcl']
    })
    vi.mocked(readKclVersion).mockImplementationOnce(
      async (_contents, wasm) => {
        await wasm
        return '3.0'
      }
    )
    const settings = createTestSettings()
    settings.current.peek().modeling.useLocalRenderer.user = local
    const registry = new Registry()
    await registry.configure([
      testCommands,
      testKeymap,
      userFeaturesExtension,
      editorsExtension,
      executorsExtension,
      kclExtension,
      provide(fileOperationsService, testFileOperations),
      [[provide(settingsService, settings)]],
    ])
    try {
      const editors = registry.required(editorsService)
      const editor = requireSuccess(
        editors.createEditor('@settings(kclVersion = 3.0)\nanswer = 42')
      )
      requireSuccess(editors.setLanguage(editor.id, 'kcl'))
      const view = requireSuccess(editors.createView(editor, 'kcl.modeling'))
      await vi.waitFor(() =>
        expect(editors.viewState(view).peek().binding.type).toBe('ready')
      )
      const binding = editors.viewState(view).peek().binding
      if (binding.type !== 'ready')
        throw new Error('Modeling view did not bind')
      const mounted = render(
        <binding.Component editor={editor} instance={view} active />
      )
      try {
        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Missing WASM promise registry value.'
        )
        await vi.waitFor(() => {
          const executions = registry
            .required(executorsService)
            .executors.peek()
          expect(executions).toHaveLength(1)
          expect(executions[0].output.peek().errors['kcl.execution']).toEqual(
            new Error('Missing WASM promise registry value.')
          )
          expect(executions[0].output.peek().running).toBe(false)
        })
        expect(initialiseWasm).not.toHaveBeenCalled()
        expect(openKclScene).not.toHaveBeenCalled()
      } finally {
        mounted.unmount()
      }
    } finally {
      await registry.dispose()
    }
  }
)

it('keeps a pending shared capture alive when one Modeling view closes', async () => {
  vi.clearAllMocks()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
  const pending = Promise.withResolvers<string[]>()
  vi.mocked(readKclFileExtensions).mockImplementationOnce(() => pending.promise)
  const resources: KclSceneResource[] = []
  vi.mocked(openKclScene).mockImplementation(
    async ({ preferences, presentation }) => {
      const resource = createTestKclScene(presentation, { preferences })
      resources.push(resource)
      return resource
    }
  )
  const registry = new Registry()
  await registry.configure([
    testCommands,
    testKeymap,
    userFeaturesExtension,
    editorsExtension,
    executorsExtension,
    kclExtension,
    provide(fileOperationsService, testFileOperations),
    [
      [provide(settingsService, createTestSettings())],
      [contribute(wasmPromiseFacet, () => new Promise<ModuleType>(() => {}))],
    ],
  ])
  try {
    const editors = registry.required(editorsService)
    const editor = requireSuccess(
      editors.createEditor('@settings(kclVersion = 3.0)\nanswer = 42')
    )
    requireSuccess(editors.setLanguage(editor.id, 'kcl'))
    const first = requireSuccess(editors.createView(editor, 'kcl.modeling'))
    const second = requireSuccess(editors.createView(editor, 'kcl.modeling'))
    const a = editors.viewState(first).peek().binding,
      b = editors.viewState(second).peek().binding
    if (a.type !== 'ready' || b.type !== 'ready')
      throw new Error('Modeling did not bind')
    const mounted = render(
      <>
        <a.Component editor={editor} instance={first} active />
        <b.Component editor={editor} instance={second} active />
      </>
    )
    try {
      await vi.waitFor(() => expect(resources).toHaveLength(2))
      expect(registry.required(executorsService).executors.peek()).toHaveLength(
        1
      )
      await act(async () => {
        requireSuccess(editors.closeView(first.id))
      })
      await vi.waitFor(() =>
        expect(resources[0].dispose).toHaveBeenCalledOnce()
      )
      expect(resources[1].dispose).not.toHaveBeenCalled()
      pending.resolve(['kcl'])
      await vi.waitFor(() =>
        expect(resources[1].runtime.execute).toHaveBeenCalledOnce()
      )
      expect(resources[0].runtime.execute).not.toHaveBeenCalled()
      expect(readKclFileExtensions).toHaveBeenCalledOnce()
      await act(async () => {
        requireSuccess(editors.closeView(second.id))
      })
      await vi.waitFor(() =>
        expect(resources[1].dispose).toHaveBeenCalledOnce()
      )
      expect(registry.required(executorsService).executors.peek()).toEqual([])
    } finally {
      mounted.unmount()
    }
  } finally {
    await registry.dispose()
  }
})

it.each([false, true])(
  'switches existing views when the renderer setting changes, retaining cameras and the shared executor (initial local: %s)',
  async (local) => {
    vi.mocked(openKclScene).mockClear()
    vi.mocked(readKclFileExtensions).mockClear()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
    const resources: KclSceneResource[] = []
    vi.mocked(openKclScene).mockImplementation(async (options) => {
      const resource = createTestKclScene(options.presentation)
      resources.push(resource)
      return resource
    })
    const settings = createTestSettings()
    settings.current.peek().modeling.useLocalRenderer.user = local
    const registry = new Registry()
    await registry.configure([
      testCommands,
      testKeymap,
      userFeaturesExtension,
      editorsExtension,
      executorsExtension,
      kclExtension,
      provide(fileOperationsService, testFileOperations),
      [
        [provide(settingsService, settings)],
        [contribute(wasmPromiseFacet, () => new Promise<ModuleType>(() => {}))],
      ],
    ])
    try {
      const editors = registry.required(editorsService)
      const editor = requireSuccess(
        editors.createEditor('@settings(kclVersion = 3.0)\nanswer = 42')
      )
      requireSuccess(editors.setLanguage(editor.id, 'kcl'))
      const first = requireSuccess(editors.createView(editor, 'kcl.modeling'))
      const second = requireSuccess(editors.createView(editor, 'kcl.modeling'))
      const a = editors.viewState(first).peek().binding
      const b = editors.viewState(second).peek().binding
      if (a.type !== 'ready' || b.type !== 'ready')
        return expect.fail('Modeling did not bind')
      render(
        <>
          <a.Component editor={editor} instance={first} active />
          <b.Component editor={editor} instance={second} active />
        </>
      )
      await vi.waitFor(() => {
        expect(resources).toHaveLength(2)
        for (const resource of resources)
          expect(resource.runtime.execute).toHaveBeenCalledOnce()
      })
      const shared = registry.required(executorsService).executors.peek()[0]
      const poses = resources.map((resource, index) => ({
        ...resource.snapshotCamera(),
        eye_offset: 100 + index * 50,
        is_ortho: index === 1,
      }))
      resources.forEach((resource, index) =>
        vi.mocked(resource.snapshotCamera).mockReturnValue(poses[index])
      )
      for (const desired of [!local, local]) {
        const retired = resources.slice(-2)
        const count = resources.length
        await act(async () => {
          settings.current.peek().modeling.useLocalRenderer.user = desired
        })
        await vi.waitFor(() => {
          expect(resources).toHaveLength(count + 2)
          const next = resources.slice(-2)
          for (const resource of next) {
            expect(resource.presentation).toBe(desired ? 'local' : 'streamed')
            expect(resource.runtime.execute).toHaveBeenCalledOnce()
            expect(resource.restoreCamera).toHaveBeenCalledOnce()
            expect(resource.frameModel).not.toHaveBeenCalled()
          }
          expect(
            next.flatMap((resource) =>
              vi.mocked(resource.restoreCamera).mock.calls.map(([pose]) => pose)
            )
          ).toEqual(expect.arrayContaining(poses))
        })
        for (const resource of retired)
          expect(resource.dispose).toHaveBeenCalledOnce()
        expect(registry.required(executorsService).executors.peek()).toEqual([
          shared,
        ])
        expect(readKclFileExtensions).toHaveBeenCalledOnce()
        resources
          .slice(-2)
          .forEach((resource, index) =>
            vi.mocked(resource.snapshotCamera).mockReturnValue(poses[index])
          )
      }
      await act(async () => {
        settings.current.peek().modeling.useLocalRenderer.user = local
      })
      expect(resources).toHaveLength(6)
      requireSuccess(editors.closeEditor(editor.id))
    } finally {
      await registry.dispose()
    }
  }
)

it('shows stale tabs with Automatically Render Off and refreshes through the Render command', async () => {
  const { createSettings } = await import('@src/lib/settings/initialSettings')
  const { defineBooleanExtensionSetting } = await import(
    '@src/lib/settings/extensionSettings'
  )
  const settingsProvider = createTestSettings()
  const automatic = defineBooleanExtensionSetting({
    defaultValue: false,
    description: 'Automatically render changes',
  }).createSetting()
  const settings = {
    ...createSettings(),
    textEditor: {
      ...settingsProvider.current.peek().textEditor,
      automaticallyRender: automatic,
    },
  }
  settingsProvider.current.value = settings
  const resource = createTestKclScene('streamed')
  const initialExecution =
    Promise.withResolvers<ReturnType<typeof resource.runtime.state.peek>>()
  vi.mocked(resource.runtime.execute).mockImplementationOnce(
    () => initialExecution.promise
  )
  vi.mocked(openKclScene).mockResolvedValue(resource)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
  const registry = new Registry()
  await registry.configure([
    testCommands,
    testKeymap,
    userFeaturesExtension,
    editorsExtension,
    executorsExtension,
    kclExtension,
    provide(fileOperationsService, testFileOperations),
    provide(settingsService, settingsProvider),
    contribute(wasmPromiseFacet, () => new Promise<ModuleType>(() => {})),
  ])
  let mounted: ReturnType<typeof render> | undefined
  try {
    const editors = registry.required(editorsService)
    const editor = requireSuccess(
      editors.createEditor('@settings(kclVersion = 3.0)\nanswer = 42')
    )
    requireSuccess(editors.setLanguage(editor.id, 'kcl'))
    const instance = requireSuccess(editors.createView(editor, 'kcl.modeling'))
    await vi.waitFor(() =>
      expect(editors.viewState(instance).peek().binding.type).toBe('ready')
    )
    const binding = editors.viewState(instance).peek().binding
    if (binding.type !== 'ready') return expect.fail('Modeling did not bind')
    mounted = render(
      <EditorsPane
        editors={editors}
        indicators={registry.observe(editorTabIndicatorsFacet)}
        layout={{
          id: 'editors',
          label: 'Editors',
          type: LayoutType.Simple,
          areaType: 'editors',
        }}
      />
    )
    await vi.waitFor(() =>
      expect(resource.runtime.execute).toHaveBeenCalledOnce()
    )
    expect(screen.getByRole('tab')).not.toHaveTextContent('Stale')
    await act(async () => {
      initialExecution.resolve(resource.runtime.state.peek())
    })
    expect(screen.getByRole('tab')).not.toHaveTextContent('Stale')
    await act(async () => {
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: '@settings(kclVersion = 3.0)\nanswer = 84',
        },
      })
      settings.modeling.defaultUnit.user = 'in'
    })
    expect(resource.runtime.execute).toHaveBeenCalledOnce()
    expect(screen.getByRole('tab')).toHaveTextContent('Stale')
    expect(screen.queryByLabelText('Model freshness')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Render$/ })
    ).not.toBeInTheDocument()
    act(() => instance.element.peek()?.focus())
    const renderCommand = registry
      .get(commandsFacet)
      .find(({ id }) => id === KCL_RENDER_COMMAND)
    if (!renderCommand) return expect.fail('Render command was not registered')
    await act(async () => {
      await renderCommand.onSubmit()
    })
    await vi.waitFor(() => {
      expect(resource.runtime.execute).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('tab')).not.toHaveTextContent('Stale')
    })
    const [snapshot, configuration] = vi.mocked(resource.runtime.execute).mock
      .calls[1]
    expect(new TextDecoder().decode(snapshot.files.get('main.kcl'))).toContain(
      'answer = 84'
    )
    expect(configuration).toEqual(
      registry.required(kclExecutionSettingsService).configuration.peek()
    )
    await act(async () => {
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: '@settings(kclVersion = 3.0)\nanswer = 126',
        },
      })
      automatic.user = true
    })
    await vi.waitFor(() =>
      expect(resource.runtime.execute).toHaveBeenCalledTimes(3)
    )
    await act(async () => {
      automatic.user = false
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: '@settings(kclVersion = 3.0)\nanswer = 168',
        },
      })
    })
    expect(resource.runtime.execute).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('tab')).toHaveTextContent('Stale')
  } finally {
    initialExecution.resolve(resource.runtime.state.peek())
    mounted?.unmount()
    await registry.dispose()
  }
})
