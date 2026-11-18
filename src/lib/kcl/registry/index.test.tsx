import '@src/lib/projectSession/next/testFeature'
import { contribute, provide, Registry } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import executorsExtension from '@src/lib/executors/registry'
import { executorsService } from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import kclExtension from '@src/lib/kcl/registry'
import { kclExecutionSettingsService } from '@src/lib/kcl/scene/executionSettingsContract'
import type { KclSceneResource } from '@src/lib/kcl/scene'
import { openKclScene } from '@src/lib/kcl/scene'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseFacet } from '@src/registry/contracts/wasm'
import { act, render } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import {
  createTestKclScene,
  createTestSettings,
} from '@src/lib/kcl/testFixtures'

vi.mock('@src/clientSideScene/localRenderer/LocalWebGPUScene', () => ({
  LocalWebGPUSceneView: () => null,
}))
vi.mock('@src/lib/kcl/scene', () => ({ openKclScene: vi.fn() }))
vi.mock('@src/lib/kcl/nativeInputs', () => ({
  readKclVersion: async () => '3.0',
  readKclFileExtensions: async () => ['kcl'],
}))
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
afterEach(() => vi.restoreAllMocks())
it.each([false, true])(
  'binds classified buffers to independent Modeling scenes (local rendering: %s)',
  async (local) => {
    vi.mocked(openKclScene).mockClear()
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
    const registry = new Registry()
    await registry.configure([
      editorsExtension,
      executorsExtension,
      kclExtension,
      [
        [provide(settingsService, settingsProvider)],
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
      const nativeSettings = registry.required(kclExecutionSettingsService)
      for (const [options] of vi.mocked(openKclScene).mock.calls) {
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
        settings.modeling.useLocalRenderer.user = !local
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
      expect(fresh.presentation).toBe(local ? 'streamed' : 'local')
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
        expect(fresh.runtime.execute).toHaveBeenCalledTimes(local ? 2 : 1)
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
      await act(async () => {
        requireSuccess(editors.closeEditor(editor.id))
      })
      await vi.waitFor(() =>
        expect(resources[1].dispose).toHaveBeenCalledOnce()
      )
    } finally {
      await registry.dispose()
    }
  }
)
