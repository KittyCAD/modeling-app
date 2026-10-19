import { signal } from '@preact/signals-core'
import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'
import * as activeTextFile from '@src/lib/activeTextFile'
import { app } from '@src/lib/boot'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import { LayoutType } from '@src/lib/layout/types'
import type { FileEntry, Project } from '@src/lib/project'
import { ZDSProject } from '@src/lib/projectSession'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({ state: { matches: () => false } }),
}))

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProjectExplorerPane', () => {
  it('opens non-KCL files on click and Enter while keeping KCL on the modeling path', async () => {
    const projectPath = '/applicationDirectory/project-001'
    const createFile = (name: string): FileEntry => ({
      name,
      path: `${projectPath}/${name}`,
      children: null,
    })
    const textFiles = ['LICENSE', 'part.STEP'].map(createFile)
    const oneFile = createFile('main.kcl')
    const folder: FileEntry = {
      name: 'folder.step',
      path: `${projectPath}/folder.step`,
      children: [],
    }
    const project: Project = {
      metadata: null,
      kcl_file_count: 1,
      directory_count: 1,
      default_file: oneFile.path,
      path: projectPath,
      name: 'project-001',
      children: [...textFiles, oneFile, folder],
      readWriteAccess: true,
    }
    const wasmInstance = {} as ModuleType
    vi.spyOn(app, 'project', 'get').mockReturnValue(
      await ZDSProject.open(signal(project), app)
    )
    vi.spyOn(
      app.singletons.kclManager,
      'wasmInstancePromise',
      'get'
    ).mockReturnValue(Promise.resolve(wasmInstance))
    const openText = vi
      .spyOn(activeTextFile, 'openActiveTextFile')
      .mockResolvedValue()
    const clearText = vi
      .spyOn(activeTextFile, 'clearActiveTextFile')
      .mockImplementation(() => {})
    const flushKcl = vi
      .spyOn(app.singletons.kclManager, 'flushWriteToFile')
      .mockResolvedValue(true)
    const send = vi
      .spyOn(app.systemIOActor, 'send')
      .mockImplementation(() => {})

    await act(async () => {
      render(
        <Suspense>
          <ProjectExplorerPane
            areaConfig={{ hide: () => false }}
            layout={{
              type: LayoutType.Simple,
              id: 'files',
              label: 'Files',
              areaType: 'files',
            }}
          />
        </Suspense>
      )
    })

    for (const file of textFiles) {
      fireEvent.click(screen.getByRole('treeitem', { name: file.name }))
      expect(openText).toHaveBeenCalledWith(app.fileOperations, file.path)
      openText.mockClear()
    }

    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() =>
      expect(openText).toHaveBeenCalledWith(
        app.fileOperations,
        textFiles[1].path
      )
    )
    openText.mockClear()

    fireEvent.click(screen.getByRole('treeitem', { name: folder.name }))
    expect(openText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('treeitem', { name: oneFile.name }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: SystemIOMachineEvents.navigateToFile })
      )
    )
    expect(openText).not.toHaveBeenCalled()
    expect(clearText).toHaveBeenCalled()
    expect(flushKcl).toHaveBeenCalled()
  })
})
