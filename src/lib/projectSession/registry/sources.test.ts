import '@src/lib/projectSession/next/testFeature'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import projectExtension from '@src/lib/projectSession/registry'
import sourcesExtension from '@src/lib/projectSession/registry/sources'
import {
  projectSessionService,
  projectSourcesService,
} from '@src/lib/projectSession/next/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { beforeAll, expect, it, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
it('composes one project source provider and reads unsaved editor documents through it', async () => {
  const readFile = vi.fn(async () => new TextEncoder().encode('stored module'))
  const registry = new Registry()
  registry.configure([
    editorsExtension,
    projectExtension,
    sourcesExtension,
    defineRegistryItem({
      providesServices: [
        provideService(fileOperationsService, {
          ...testFileOperations,
          readFile,
        }),
      ],
    }),
  ])
  try {
    registry.get(projectSessionService).openProject({
      contents: {
        name: 'model',
        path: '/model',
        children: ['main.kcl', 'module.kcl'].map((name) => ({
          name,
          path: `/model/${name}`,
          children: null,
        })),
      },
      metadata: { title: 'Model', readWriteAccess: true },
    })
    const editor = requireSuccess(
      registry
        .get(editorsService)
        .openEditor('/model/module.kcl', 'unsaved module')
    )
    const sources = registry.get(projectSourcesService)
    const request = {
      document: { src: '/model/main.kcl', contents: 'working entrypoint' },
      unnamedPath: 'draft.txt',
      signal: new AbortController().signal,
    }
    const original = sources.revision.value
    const captured = await sources.capture(request)
    if (captured instanceof Error) return expect.fail(captured.message)
    expect(captured.files.get('/model/module.kcl')).toEqual(
      new TextEncoder().encode('unsaved module')
    )
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'new unsaved module',
      },
    })
    expect(sources.revision.value).not.toBe(original)
    const newer = await sources.capture(request)
    if (newer instanceof Error) return expect.fail(newer.message)
    expect(newer.files.get('/model/module.kcl')).toEqual(
      new TextEncoder().encode('new unsaved module')
    )
    expect(captured.files.get('/model/module.kcl')).toEqual(
      new TextEncoder().encode('unsaved module')
    )
    expect(readFile).not.toHaveBeenCalled()
  } finally {
    registry[Symbol.dispose]()
  }
})
