import { vi, describe, expect, it } from 'vitest'
import { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'

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

vi.mock(`@rust/kcl-wasm-lib/pkg/kcl_wasm_lib`)
vi.mock('@src/lang/wasmUtils', async () => {
  const realImport = await import('@src/lang/wasmUtils')
  // We have to mock this because it fetches by default
  const mockInitialiseWasm = () => import(`@rust/kcl-wasm-lib/pkg/kcl_wasm_lib`)
  return {
    ...realImport,
    initialiseWasm: mockInitialiseWasm,
  } satisfies typeof realImport
})

describe('project system', () => {
  it('can open, close project', () => {
    const app = new App()

    app.openProject(
      mockProject,
      mockProject.children![0].path,
      app.singletons.kclManager
    )

    expect(app.project.value).toBeDefined()
    expect(app.project.value?.executingPath).toEqual('/some-dir/test/main.kcl')
    expect(app.project.value?.executingFileEntry.name).toEqual('main.kcl')

    app.closeProject()

    expect(app.project.value).toBeNull()
  })
})
