import correspondenceExtension from '@src/lib/kclCorrespondence/registry'
import '@src/lib/projectSession/next/testFeature'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
  Slot,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { emptyExecState } from '@src/lang/wasm'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import executorsExtension from '@src/lib/executors/registry'
import { executorsService } from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import kclExtension from '@src/lib/kcl/registry'
import type { KclSceneResource } from '@src/lib/kcl/scene'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import { openKclScene } from '@src/lib/kcl/scene'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { act, render } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

vi.mock('@src/clientSideScene/localRenderer/LocalWebGPUScene', () => ({
  LocalWebGPUSceneView: () => null,
}))
vi.mock('@src/lib/kcl/scene', () => ({ openKclScene: vi.fn() }))
vi.mock('@src/lang/kclLanguageVersion', () => ({
  getKclLanguageVersion: () => '3.0',
}))
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
afterEach(() => vi.restoreAllMocks())
it.each([false, true])(
  'binds classified buffers to independent Modeling scenes (local rendering: %s)',
  async (local) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
    const resources: KclSceneResource[] = []
    vi.mocked(openKclScene).mockImplementation(
      async ({ preferences, presentation }) => {
        const fixture = modelingTestContext()
        const resource = {
          ...fixture.resource,
          element: document.createElement('div'),
          preferences,
          presentation,
          localHost: undefined,
          runtime: {
            ...fixture.resource.runtime,
            execute: vi.fn(async () => emptyExecState()),
          },
          resize: vi.fn(async () => {}),
          resume: vi.fn(),
          applySettings: vi.fn(async () => {}),
          frameModel: vi.fn(async () => {}),
          dispose: vi.fn(async () => {
            fixture.dispose()
          }),
        } as unknown as KclSceneResource
        resources.push(resource)
        return resource
      }
    )
    const settings = createSettings()
    settings.modeling.highlightEdges.user = false
    settings.modeling.useLocalRenderer.user = local
    const registry = new Registry()
    const correspondence = new Slot()
    registry.configure([
      editorsExtension,
      executorsExtension,
      kclExtension,
      correspondence.of(correspondenceExtension),
      defineRegistryItem({
        providesServices: [
          provideService(settingsService, {
            current: signal(settings),
            actor: {},
          } as unknown as SettingsRegistryService),
        ],
        provides: [
          provide(
            wasmPromiseValueSpec,
            Promise.resolve({
              relevant_file_extensions: () => ['kcl'],
            } as unknown as ModuleType)
          ),
        ],
      }),
    ])
    try {
      const editors = registry.get(editorsService)
      const editor = requireSuccess(
        editors.createEditor('@settings(kclVersion = 3.0)\nanswer = 42')
      )
      requireSuccess(editors.setLanguage(editor.id, 'kcl'))
      const first = requireSuccess(editors.createView(editor, 'kcl.modeling'))
      const second = requireSuccess(editors.createView(editor, 'kcl.modeling'))
      await vi.waitFor(() =>
        expect(editors.viewState(first).peek().binding.type).toBe('ready')
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
      await vi.waitFor(() =>
        expect(
          registry
            .get(executorsService)
            .executors.peek()
            .every((executor) => !executor.output.peek().running)
        ).toBe(true)
      )
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
      const executorIds = registry
        .get(executorsService)
        .executors.peek()
        .map((executor) => executor.id)
      await act(async () => {
        registry.reconfigure(correspondence, [])
      })
      expect(
        registry
          .get(executorsService)
          .executors.peek()
          .map((executor) => executor.id)
      ).toEqual(executorIds)
      expect(
        resources.every(
          (resource) => !vi.mocked(resource.dispose).mock.calls.length
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
      mounted.unmount()
      expect(resources[0].dispose).not.toHaveBeenCalled()
      await act(async () => {
        requireSuccess(editors.closeView(first.id))
      })
      await vi.waitFor(() =>
        expect(resources[0].dispose).toHaveBeenCalledOnce()
      )
      expect(resources[1].dispose).not.toHaveBeenCalled()
      await act(async () => {
        requireSuccess(editors.closeEditor(editor.id))
      })
      await vi.waitFor(() =>
        expect(resources[1].dispose).toHaveBeenCalledOnce()
      )
    } finally {
      registry[Symbol.dispose]()
    }
  }
)
