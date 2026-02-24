import { describe, expect, it } from 'vitest'
import { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

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
  path: '/some-dir/test',
  readWriteAccess: true,
  children: [
    {
      name: 'main.kcl',
      path: '/some-dir/test/main.kcl',
      children: [],
    },
  ],
}

describe('project system', () => {
  it('can open, close project', () => {
    const app = App.fromProvided({
      wasmPromise: Promise.resolve({} as ModuleType),
    })

    app.openProject(
      mockProject,
      mockProject.children![0].path,
      app.singletons.kclManager
    )

    expect(app.project).toBeDefined()
    expect(app.project?.executingPath).toEqual('/some-dir/test/main.kcl')
    expect(app.project?.executingFileEntry.value.name).toEqual('main.kcl')

    app.closeProject()

    expect(app.project).toBeUndefined()
  })
})
