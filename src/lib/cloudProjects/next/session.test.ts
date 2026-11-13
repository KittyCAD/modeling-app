import '@src/lib/projectSession/next/testFeature'
import nextSessionExtension from '@src/lib/cloudProjects/registry/nextSession'
import routerExtension from '@src/registry/extensions/router'
import { routerService } from '@src/registry/contracts/router'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { editorAutosavePoliciesValueSpec } from '@src/lib/save/registry/contract'
import { posix } from '@chainner/node-path'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createCloudProjectsServices } from '@src/lib/cloudProjects/service'
import * as api from '@src/lib/cloudProjects/runtime/api'
import { parseProjectArchive } from '@src/lib/cloudProjects/runtime/archive'
import { watchCloudEditorSession } from '@src/lib/cloudProjects/next/session'
import { createFileOperationsServices } from '@src/registry/extensions/fileOperations'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type * as ArchiveModule from '@src/lib/cloudProjects/runtime/archive'
import noopfs from '@src/lib/fs-zds/noopfs'
import { readProject } from '@src/lib/projectSession/next/utils'
import projectSessionExtension from '@src/lib/projectSession/registry'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import saveExtension from '@src/lib/save/registry'
import { editorSaveService } from '@src/lib/save/registry/contract'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'

vi.mock('@src/lib/cloudProjects/runtime/api', async (original) => ({
  ...(await original<typeof api>()),
  getRemoteProject: vi.fn(),
  downloadRemoteProjectArchive: vi.fn(),
  updateRemoteProject: vi.fn(),
}))
vi.mock('@src/lib/cloudProjects/runtime/archive', async (original) => ({
  ...(await original<typeof ArchiveModule>()),
  parseProjectArchive: vi.fn(),
}))
const file = (relativePath: string, text: string) => ({
  relativePath,
  data: new TextEncoder().encode(text),
})
const archive = (text: string) => [
  file('main.kcl', text),
  file('project.toml', 'title="Bracket"'),
]
let registry: Registry
let cloudServices: ReturnType<typeof createCloudProjectsServices>
let fileServices: ReturnType<typeof createFileOperationsServices>
let stop: () => void
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(() => {
  vi.mocked(api.getRemoteProject).mockResolvedValue({
    id: 'one',
    revision: '1',
  })
  vi.mocked(api.downloadRemoteProjectArchive).mockResolvedValue(
    new ArrayBuffer(0)
  )
  vi.mocked(parseProjectArchive).mockResolvedValue(archive('original'))
  vi.mocked(api.updateRemoteProject).mockResolvedValue({
    id: 'one',
    revision: '2',
  })
})
afterEach(async () => {
  stop?.()
  registry?.[Symbol.dispose]()
  await fileServices?.dispose()
  await cloudServices?.dispose()
  vi.resetAllMocks()
})

async function setup(bridge = false) {
  const paths = { ...noopfs.impl, ...posix }
  cloudServices = createCloudProjectsServices(paths, () => ({
    enabled: true,
    accountId: 'test-account',
  }))
  fileServices = createFileOperationsServices(paths, undefined, () => [
    cloudServices.mount,
  ])
  registry = new Registry()
  registry.configure([
    editorsExtension,
    saveExtension,
    projectSessionExtension,
    ...(bridge ? [routerExtension, nextSessionExtension] : []),
    defineRegistryItem({
      providesServices: [
        provideService(fileOperationsService, fileServices.operations),
        provideService(cloudStorageService, cloudServices.cloud),
      ],
    }),
  ])
  const cloud = cloudServices.cloud
  const root = await cloud.openProject('one')
  const projects = registry.get(projectSessionService)
  const session = projects.openProject({
    ...(await readProject(fileServices.operations, root)),
    storage: { type: 'cloud', projectId: 'one' },
  })
  const editors = registry.get(editorsService)
  const editor = requireSuccess(
    editors.openEditor(`${root}/main.kcl`, 'original')
  )
  const saving = registry.get(editorSaveService)
  stop = bridge
    ? () => {}
    : watchCloudEditorSession({ cloud, projects, session, editors, saving })
  return { cloud, projects, session, editors, editor, saving }
}

it('updates clean buffers, baselines, and the file list together after a remote change', async () => {
  const { cloud, projects, editor, saving } = await setup()
  vi.mocked(api.getRemoteProject).mockResolvedValue({
    id: 'one',
    revision: '2',
  })
  vi.mocked(parseProjectArchive).mockResolvedValue([
    ...archive('remote edit'),
    file('nested/added.md', 'new file'),
  ])
  await cloud.checkForUpdates('one', () => true)
  expect(editor.contents.peek()).toBe('remote edit')
  expect(saving.state(editor).peek().dirty).toBe(false)
  expect(projects.listFiles().map((file) => file.name)).toContain('added.md')
  expect(api.updateRemoteProject).not.toHaveBeenCalled()
})

it('protects unsaved edits from polling but adopts remote contents after a conflicting write', async () => {
  const { cloud, editor, saving, projects } = await setup()
  editor.dispatch({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: 'my unsaved edit',
    },
  })
  vi.mocked(api.getRemoteProject).mockResolvedValue({
    id: 'one',
    revision: '2',
  })
  vi.mocked(parseProjectArchive).mockResolvedValue(
    archive('other person’s edit')
  )
  // Even a caller that considers the storage clean cannot override this session's veto.
  expect(await cloud.checkForUpdates('one', () => true)).toEqual({
    changed: true,
    refreshed: false,
  })
  expect(editor.contents.peek()).toBe('my unsaved edit')
  vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
    new api.CloudApiError(409, 'Revision changed')
  )
  expect(await saving.save(editor)).toBeUndefined()
  expect(editor.contents.peek()).toBe('other person’s edit')
  expect(saving.state(editor).peek().dirty).toBe(false)
  expect(
    projects.currentSession.peek()?.project.peek().storage?.projectId
  ).toBe('one')
})

it('drops its snapshot veto and subscriptions when the project closes', async () => {
  const { cloud, editor, projects } = await setup()
  editor.dispatch({ changes: { from: 0, insert: 'dirty ' } })
  projects.closeProject()
  vi.mocked(api.getRemoteProject).mockResolvedValue({
    id: 'one',
    revision: '2',
  })
  vi.mocked(parseProjectArchive).mockResolvedValue(archive('remote edit'))
  expect(await cloud.checkForUpdates('one', () => true)).toEqual({
    changed: true,
    refreshed: true,
  })
  expect(editor.contents.peek()).toBe('dirty original')
  expect(projects.currentSession.peek()).toBeUndefined()
})

it('withdraws cloud policies and the snapshot veto outside the new cloud route', async () => {
  const { cloud, editor } = await setup(true)
  const router = registry.get(routerService)
  const navigate = (pathname: string) =>
    router.setLocation({
      pathname,
      search: '',
      hash: '',
      state: null,
      key: 'test',
    })
  const required = () =>
    registry
      .get(editorAutosavePoliciesValueSpec)
      .find((policy) => policy.id === 'cloud.autosave')?.required.value
  navigate('/project/one')
  await vi.waitFor(() => expect(required()).toBe(true))
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  try {
    window.dispatchEvent(new Event('offline'))
    expect(editor.readOnly.peek()).toBe(true)
    navigate('/file/existing')
    expect(required()).toBe(false)
    expect(editor.readOnly.peek()).toBe(false)
    online.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    editor.dispatch({ changes: { from: 0, insert: 'dirty ' } })
    vi.mocked(api.getRemoteProject).mockResolvedValue({
      id: 'one',
      revision: '2',
    })
    vi.mocked(parseProjectArchive).mockResolvedValue(archive('remote edit'))
    expect(await cloud.checkForUpdates('one', () => true)).toEqual({
      changed: true,
      refreshed: true,
    })
    expect(editor.contents.peek()).toBe('dirty original')
  } finally {
    online.mockRestore()
  }
})
