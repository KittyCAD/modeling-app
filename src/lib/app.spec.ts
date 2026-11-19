import { beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { waitFor } from 'xstate'
import { join, sep } from 'path'
import { App } from '@src/lib/app'
import { File } from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'
import { loadWasm } from '@src/unitTestUtils'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

const projectPath = join(sep, 'some-dir', 'test')
const mainPath = join(projectPath, 'main.kcl')

const mockProject: Project = {
  name: 'test',
  default_file: 'main.kcl',
  directory_count: 0,
  kcl_file_count: 1,
  metadata: {
    accessed: null,
    created: null,
    modified: null,
    permission: null,
    size: 100,
    type: null,
  },
  path: projectPath,
  readWriteAccess: true,
  children: [
    {
      name: 'main.kcl',
      path: mainPath,
      children: [],
    },
  ],
}

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('project system', () => {
  it('can open, close project', async () => {
    // Stub out File read and write implementations
    File.ioImplementations.read = () => Promise.resolve('')
    File.ioImplementations.write = () => Promise.resolve()

    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

    onTestFinished(() => {
      app.closeProject()
      app.auth.actor.stop()
      app.billing.actor.stop()
      app.commands.actor.stop()
      app.settings.actor.stop()
      app.systemIOActor.stop()
      app.machineManager.stop()
      app.layout.saveEffectUnsubscribeFn()
    })

    // Authentication starts with the app. Let it settle before the test's
    // environment is torn down, otherwise its pending logs outlive the worker.
    await waitFor(
      app.auth.actor,
      (state) => !state.matches('checkIfLoggedIn'),
      { timeout: 10_000 }
    )

    const project = await app.openProject(mockProject)

    expect(app.project).toBeDefined()
    expect(app.project?.executingPath).toBeNull()
    expect(app.project?.executingFileEntry.value.name).toEqual('')

    await project.openEditor(mockProject.children![0].path)
    expect(app.project?.executingPath).toEqual(mainPath)
    expect(app.project?.executingFileEntry.value.name).toEqual('main.kcl')

    app.closeProject()

    expect(app.project).toBeUndefined()
  })
})
