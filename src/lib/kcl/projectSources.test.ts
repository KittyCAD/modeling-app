import '@src/lib/projectSession/next/testFeature'
import { Registry } from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorsService,
  type ExecutorRunContext,
} from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { loadKclProjectSources } from '@src/lib/kcl/projectSources'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import type { Project } from '@src/lib/projectSession/next/types'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const project: Project = {
  contents: {
    name: 'project',
    path: '/project',
    children: [
      { name: 'main.kcl', path: '/project/main.kcl', children: null },
      {
        name: 'parts',
        path: '/project/parts',
        children: [
          { name: 'part.kcl', path: '/project/parts/part.kcl', children: null },
        ],
      },
      { name: 'image.png', path: '/project/image.png', children: null },
    ],
  },
  metadata: { title: 'Project', readWriteAccess: true },
}
let registry: Registry
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(() => {
  registry = new Registry()
  registry.configure([editorsExtension, executorsExtension])
})
afterEach(() => registry[Symbol.dispose]())
function setup() {
  const readFile = vi.fn(async (_src: string) =>
    new TextEncoder().encode('saved module')
  )
  const projects = createProjectSessionService(() => ({
    readFile,
    writeFile: vi.fn(),
  }))
  projects.openProject(project)
  const editors = registry.get(editorsService)
  const editor = editors.openEditor(
    '/project/main.kcl',
    'newer editor contents'
  )
  const controller = new AbortController()
  const context: ExecutorRunContext = {
    editor,
    executor: registry.get(executorsService).createExecutor(editor),
    src: '/project/main.kcl',
    signal: controller.signal,
  }
  return { readFile, projects, editors, context, controller }
}

it('loads nested KCL modules from the captured project, keeping the bound input snapshot', async () => {
  const { readFile, projects, editors, context } = setup()
  const sources = await loadKclProjectSources(
    'captured entrypoint',
    context,
    projects,
    editors.editors.peek()
  )
  expect(sources).toEqual(
    new Map([
      ['/project/main.kcl', 'captured entrypoint'],
      ['/project/parts/part.kcl', 'saved module'],
    ])
  )
  expect(readFile).toHaveBeenCalledExactlyOnceWith('/project/parts/part.kcl')
})

it('uses unsaved imported editors, resolving duplicate sources in favor of the bound editor', async () => {
  const { readFile, projects, editors, context } = setup()
  editors.openEditor('/project/main.kcl', 'another independent editor')
  editors.openEditor('/project/parts/part.kcl', 'unsaved module')
  const sources = await loadKclProjectSources(
    'bound snapshot',
    context,
    projects,
    editors.editors.peek()
  )
  expect(sources).toEqual(
    new Map([
      ['/project/main.kcl', 'bound snapshot'],
      ['/project/parts/part.kcl', 'unsaved module'],
    ])
  )
  expect(readFile).not.toHaveBeenCalled()
})

it.each(['cancel', 'close', 'replace'] as const)(
  'discards file reads after %s',
  async (action) => {
    const { readFile, projects, editors, context, controller } = setup()
    const pending = Promise.withResolvers<Uint8Array<ArrayBuffer>>()
    readFile.mockReturnValueOnce(pending.promise)
    const loading = loadKclProjectSources(
      'main',
      context,
      projects,
      editors.editors.peek()
    )
    expect(readFile).toHaveBeenCalledOnce()
    if (action === 'cancel') controller.abort()
    else if (action === 'close') projects.closeProject()
    else
      projects.openProject({
        ...project,
        contents: { ...project.contents, path: '/next' },
      })
    pending.resolve(new TextEncoder().encode('late'))
    expect(await loading).toEqual(new Error('KCL execution was cancelled'))
    expect(readFile).toHaveBeenCalledTimes(1)
  }
)

it('returns read errors instead of submitting an incomplete project', async () => {
  const { readFile, projects, editors, context } = setup()
  const failure = new Error('Cannot read imported module')
  readFile.mockRejectedValueOnce(failure)
  expect(
    await loadKclProjectSources(
      'main',
      context,
      projects,
      editors.editors.peek()
    )
  ).toBe(failure)
})

it('rejects a source outside the selected project without reading it', async () => {
  const { readFile, projects, editors, context } = setup()
  expect(
    await loadKclProjectSources(
      'main',
      { ...context, src: '/other/main.kcl' },
      projects,
      editors.editors.peek()
    )
  ).toBeInstanceOf(Error)
  expect(readFile).not.toHaveBeenCalled()
})

it('keeps single-source execution available without a project session', async () => {
  const { context } = setup()
  expect(
    await loadKclProjectSources('standalone', context, undefined, [])
  ).toBe('standalone')
})
