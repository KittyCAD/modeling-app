import '@src/lib/projectSession/next/testFeature'
import { contribute, provide, Registry } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import executorsExtension from '@src/lib/executors/registry'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import geometryExtension from '@src/lib/geometryViewer/registry'
import savingExtension from '@src/lib/save/registry'
import { editorSaveService } from '@src/lib/save/registry/contract'
import kclExtension from '@src/lib/kcl/registry'
import { openKclScene } from '@src/lib/kcl/scene/open'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { createProjectSources } from '@src/lib/projectSession/next/sources'
import {
  createTestKclScene,
  createTestSettings,
} from '@src/lib/kcl/testFixtures'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseFacet } from '@src/registry/contracts/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

vi.mock('@src/clientSideScene/localRenderer/LocalWebGPUSceneView', () => ({
  LocalWebGPUSceneView: () => null,
}))
vi.mock('@src/lib/kcl/scene/open', () => ({ openKclScene: vi.fn() }))
vi.mock('@src/lib/kcl/execution/nativeInputs', () => ({
  readKclVersion: vi.fn(async () => '3.0'),
  readKclFileExtensions: vi.fn(async () => ['.kcl', '.bin', '.glb']),
}))
vi.mock('@src/lang/wasmUtils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  initialiseWasm: vi.fn(() => new Promise<ModuleType>(() => {})),
}))
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
afterEach(() => vi.restoreAllMocks())
it.each([
  ['step', 'local'],
  ['stl', 'streamed'],
  ['ply', 'streamed'],
  ['obj', 'streamed'],
  ['glb', 'streamed'],
] as const)(
  'opens %s in a %s scene and inserts an undoable import without saving files',
  async (extension, presentation) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
    const resource = createTestKclScene(presentation)
    vi.mocked(openKclScene).mockResolvedValue(resource)
    const operations = {
      ...testFileOperations,
      readFile: vi.fn(async (path: string) =>
        path.endsWith(`.${extension}`)
          ? new Uint8Array([0, 255, 128])
          : new TextEncoder().encode(
              '@settings(kclVersion = 3.0)\nunsaved = 7\n'
            )
      ),
      writeFile: vi.fn(async () => {}),
    }
    const projects = createProjectSessionService(operations)
    projects.openProject({
      contents: {
        name: 'model',
        path: '/model',
        children: [
          `/model/parts/body.${extension}`,
          '/model/assembly/main.kcl',
        ].map((path) => ({ name: path, path, children: null })),
      },
      metadata: { title: 'Model', readWriteAccess: true },
    })
    const registry = new Registry()
    await registry.configure([
      editorsExtension,
      executorsExtension,
      kclExtension,
      geometryExtension,
      savingExtension,
      provide(projectSessionService, projects),
      provide(fileOperationsService, operations),
      provide(settingsService, createTestSettings()),
      contribute(wasmPromiseFacet, () => new Promise<ModuleType>(() => {})),
    ])
    try {
      const editors = registry.required(editorsService)
      const model = requireSuccess(
        editors.openFile(
          `/model/parts/body.${extension}`,
          new Uint8Array([0, 255, 128])
        )
      )
      expect(model.contents.peek()).toBe('')
      expect(model.readOnly.peek()).toBe(true)
      expect(
        await registry.required(editorSaveService).save(model)
      ).toBeInstanceOf(Error)
      expect(operations.writeFile).not.toHaveBeenCalled()
      const view = requireSuccess(editors.createView(model))
      await vi.waitFor(() =>
        expect(editors.viewState(view).peek().binding.type).toBe('ready')
      )
      expect(editors.viewState(view).peek().selected?.id).toBe(
        'geometry.viewer'
      )
      const binding = editors.viewState(view).peek().binding
      if (binding.type !== 'ready') return expect.fail('Viewer did not bind')
      const mounted = render(
        <binding.Component editor={model} instance={view} active />
      )
      try {
        await vi.waitFor(() =>
          expect(resource.runtime.execute).toHaveBeenCalled()
        )
        expect(
          vi.mocked(openKclScene).mock.calls.at(-1)?.[0].presentation
        ).toBe(presentation)
        const snapshot = vi.mocked(resource.runtime.execute).mock.calls[0][0]
        expect(snapshot.files.get(`/model/parts/body.${extension}`)).toEqual(
          new Uint8Array([0, 255, 128])
        )
        await act(async () => {
          fireEvent.change(
            screen.getByRole('combobox', { name: 'KCL destination' }),
            { target: { value: '/model/assembly/main.kcl' } }
          )
          fireEvent.click(
            screen.getByRole('button', { name: 'Insert into KCL' })
          )
        })
        await screen.findByText('Import inserted')
        const target = editors.editors
          .peek()
          .find((editor) => editor.src.peek() === '/model/assembly/main.kcl')!
        expect(target.contents.peek()).toContain(
          `unsaved = 7\nimport "../parts/body.${extension}" as importedModel\n`
        )
        const capture = await createProjectSources(
          () => projects,
          () => editors.editors.peek()
        ).capture({
          document: {
            src: target.src.peek(),
            contents: target.contents.peek(),
          },
          unnamedPath: 'main.kcl',
          signal: new AbortController().signal,
        })
        if (capture instanceof Error) return expect.fail(capture.message)
        expect(capture.files.get(`/model/parts/body.${extension}`)).toEqual(
          new Uint8Array([0, 255, 128])
        )
        expect(target.undo()).toBe(true)
        expect(target.contents.peek()).not.toContain('import ')
        expect(operations.writeFile).not.toHaveBeenCalled()
        await act(async () => {
          projects.closeProject()
        })
        expect(model.signal.aborted).toBe(true)
      } finally {
        mounted.unmount()
      }
    } finally {
      await registry.dispose()
    }
  }
)
