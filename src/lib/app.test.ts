import { describe, expect, it } from 'vitest'
import { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'

const project: Project = {
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
    const app = new App()

    expect(project.children![0].path).toEqual('/some-dir/test/main.kcl')

    app.openProject(
      project,
      project.children![0].path,
      app.singletons.kclManager
    )

    expect(app.project.value).toBeDefined()
    expect(app.project.value?.editors.value).toBeInstanceOf(Map)
    expect(app.project.value?.executingPath).toEqual('/some-dir/test/main.kcl')
    expect(app.project.value?.executingFileEntry.name).toEqual('main.kcl')

    app.closeProject()

    expect(app.project.value).toBeNull()
  })
})
