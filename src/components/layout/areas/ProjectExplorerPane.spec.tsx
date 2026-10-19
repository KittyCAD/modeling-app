import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineRegistryItem } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { ModelingMachineProvider } from '@src/components/ModelingMachineProvider'
import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'
import {
  activeTextFileSignal,
  clearActiveTextFile,
} from '@src/lib/activeTextFile'
import { App } from '@src/lib/app'
import { AppContext } from '@src/lib/boot'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import { LayoutType } from '@src/lib/layout/types'
import type { FileEntry, Project } from '@src/lib/project'
import { ZDSProject } from '@src/lib/projectSession'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { loadWasm } from '@src/unitTestUtils'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

let testApp: App | undefined
let projectDirectory: string | undefined

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

afterEach(async () => {
  cleanup()
  clearActiveTextFile()
  testApp?.dispose()
  if (projectDirectory)
    await rm(projectDirectory, { recursive: true, force: true })
})

describe('ProjectExplorerPane', () => {
  it('opens non-KCL files on click and Enter while keeping KCL on the modeling path', async () => {
    const app = App.fromProvided({
      registryOverrides: [
        defineRegistryItem({
          id: 'test.wasm-promise',
          provides: [provideWasmPromise(signal(loadWasm()))],
        }),
      ],
    })
    const { kclManager } = app.singletons
    testApp = app
    projectDirectory = await mkdtemp(path.join(tmpdir(), 'project-explorer-'))
    const projectName = 'project-001'
    const projectPath = path.join(projectDirectory, projectName)
    const createFile = (name: string): FileEntry => ({
      name,
      path: path.join(projectPath, name),
      children: null,
    })
    const textFiles = ['LICENSE', 'part.STEP'].map(createFile)
    const oneFile = createFile('main.kcl')
    const folder: FileEntry = {
      name: 'folder.step',
      path: path.join(projectPath, 'folder.step'),
      children: [],
    }
    await mkdir(folder.path, { recursive: true })
    await Promise.all([
      ...textFiles.map((file) => writeFile(file.path, file.name)),
      writeFile(oneFile.path, ''),
    ])
    const project: Project = {
      metadata: null,
      kcl_file_count: 1,
      directory_count: 1,
      default_file: oneFile.path,
      path: projectPath,
      name: projectName,
      children: [...textFiles, oneFile, folder],
      readWriteAccess: true,
    }
    app.project = await ZDSProject.open(signal(project), app)
    await kclManager.modelingActorPromise
    app.systemIOActor.send({
      type: SystemIOMachineEvents.setProjectDirectoryPath,
      data: { requestedProjectDirectoryPath: projectDirectory },
    })

    await act(async () => {
      render(
        <AppContext.Provider value={app}>
          <Suspense>
            <ModelingMachineProvider>
              <ProjectExplorerPane
                areaConfig={{ hide: () => false }}
                layout={{
                  type: LayoutType.Simple,
                  id: 'files',
                  label: 'Files',
                  areaType: 'files',
                }}
              />
            </ModelingMachineProvider>
          </Suspense>
        </AppContext.Provider>
      )
    })

    for (const file of textFiles) {
      fireEvent.click(await screen.findByRole('treeitem', { name: file.name }))
      await waitFor(() =>
        expect(activeTextFileSignal.value).toMatchObject({
          path: file.path,
          status: 'ready',
          text: file.name,
        })
      )
    }

    clearActiveTextFile()
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() =>
      expect(activeTextFileSignal.value).toMatchObject({
        path: textFiles[1].path,
        status: 'ready',
      })
    )

    fireEvent.click(screen.getByRole('treeitem', { name: folder.name }))
    expect(activeTextFileSignal.value?.path).toBe(textFiles[1].path)

    const editedKcl = '@settings(kclVersion = 3.0)\n'
    kclManager.path = oneFile.path
    kclManager.updateCodeEditor(editedKcl, {
      shouldExecute: false,
      shouldWriteToDisk: false,
    })
    fireEvent.click(screen.getByRole('treeitem', { name: oneFile.name }))
    await waitFor(() => {
      expect(activeTextFileSignal.value).toBeNull()
      expect(
        app.systemIOActor.getSnapshot().context.requestedFileName
      ).toMatchObject({
        project: projectName,
        file: oneFile.name,
      })
    })
    expect(await readFile(oneFile.path, 'utf8')).toBe(editedKcl)
  })
})
