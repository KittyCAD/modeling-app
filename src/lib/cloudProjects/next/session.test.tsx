import '@src/lib/projectSession/next/testFeature'
import { act, cleanup, render, screen } from '@testing-library/react'
import { CloudProjectStatus } from '@src/lib/cloudProjects/next/CloudProjectStatus'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import { codeSurface } from '@src/lib/editors/testViews'
import { editorTabIndicatorsFacet } from '@src/lib/editors/registry/contract'
import { LayoutType } from '@src/lib/layout/types'
import { EDITOR_SAVE_DEBOUNCE_MS } from '@src/lib/constants'
import nextSessionExtension from '@src/lib/cloudProjects/registry/nextSession'
import routerExtension from '@src/registry/extensions/router'
import { routerService } from '@src/registry/contracts/router'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { editorAutosavePoliciesFacet } from '@src/lib/save/registry/contract'
import { posix } from '@chainner/node-path'
import { Registry, provide, factory } from 'plankton'
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
import { createProjectSessionExtension } from '@src/lib/projectSession/registry'
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
const remoteSnapshot = (revision: string, files = archive('original')) => ({
  id: 'one',
  revision,
  files: files.map((file) => ({
    id: `${revision}-${file.relativePath}`,
    relative_path: file.relativePath,
    byte_size: file.data.byteLength,
    sha256: `hash-${revision}-${file.relativePath}`,
  })),
})
let registry: Registry
let cloudServices: ReturnType<typeof createCloudProjectsServices>
let fileServices: ReturnType<typeof createFileOperationsServices>
let stop: () => void
beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})
beforeEach(async () => {
  vi.mocked(api.getRemoteProject).mockResolvedValue(remoteSnapshot('1'))
  vi.mocked(api.downloadRemoteProjectArchive).mockResolvedValue(
    new ArrayBuffer(0)
  )
  vi.mocked(parseProjectArchive).mockResolvedValue(archive('original'))
  vi.mocked(api.updateRemoteProject).mockResolvedValue(remoteSnapshot('2'))
})
afterEach(async () => {
  cleanup()
  stop?.()
  await registry?.dispose()
  await fileServices?.dispose()
  await cloudServices?.dispose()
  vi.resetAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function setup(bridge = false) {
  const paths = {
    ...noopfs.impl,
    ...posix,
  }
  cloudServices = createCloudProjectsServices(paths, () => ({
    enabled: true,
    accountId: 'test-account',
  }))
  fileServices = createFileOperationsServices(paths, undefined, () => [
    cloudServices.mount,
  ])
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    saveExtension,
    createProjectSessionExtension(
      factory({
        create: () => ({ exports: { operations: fileServices.operations } }),
      })
    ),
    ...(bridge ? [routerExtension, nextSessionExtension] : []),
    [
      provide(fileOperationsService, fileServices.operations),
      provide(cloudStorageService, cloudServices.cloud),
    ],
  ])
  const cloud = cloudServices.cloud
  const root = await cloud.openProject('one')
  const projects = registry.required(projectSessionService)
  const session = projects.openProject({
    ...(await readProject(fileServices.operations, root)),
    storage: {
      type: 'cloud',
      projectId: 'one',
    },
  })
  const editors = registry.required(editorsService)
  const editor = requireSuccess(
    editors.openEditor(
      `${root}/main.kcl`,
      new TextDecoder().decode(
        await fileServices.operations.readFile(`${root}/main.kcl`)
      )
    )
  )
  const saving = registry.required(editorSaveService)
  stop = bridge
    ? () => {}
    : watchCloudEditorSession({
        cloud,
        projects,
        session,
        editors,
        saving,
      })
  return {
    cloud,
    projects,
    session,
    editors,
    editor,
    saving,
  }
}
it('updates clean buffers, baselines, and the file list together after a remote change', async () => {
  const { cloud, projects, editor, saving } = await setup()
  const files = [...archive('remote edit'), file('nested/added.md', 'new file')]
  vi.mocked(api.getRemoteProject).mockResolvedValue(remoteSnapshot('2', files))
  vi.mocked(parseProjectArchive).mockResolvedValue(files)
  await cloud.checkForUpdates('one', () => true)
  expect(editor.contents.peek()).toBe('remote edit')
  expect(saving.state(editor).peek().dirty).toBe(false)
  expect(projects.listFiles().map((file) => file.name)).toContain('added.md')
  expect(api.updateRemoteProject).not.toHaveBeenCalled()
})
it('maps the cursor through only the changed text when adopting a remote snapshot', async () => {
  const { cloud, editor, saving } = await setup()
  editor.dispatch({
    selection: {
      anchor: 6,
    },
  })
  const files = archive('orNEWiginal')
  vi.mocked(api.getRemoteProject).mockResolvedValue(remoteSnapshot('2', files))
  vi.mocked(parseProjectArchive).mockResolvedValue(files)
  await cloud.checkForUpdates('one', () => true)
  expect(editor.contents.peek()).toBe('orNEWiginal')
  expect(editor.state.selection.main.head).toBe(9)
  expect(saving.state(editor).peek().dirty).toBe(false)
  expect(editor.undo()).toBe(false)
})
it('does not dispatch a document change for an unchanged remote snapshot', async () => {
  const { cloud, editor, saving } = await setup()
  const changed = vi.fn()
  const unsubscribe = editor.subscribe((transaction) => {
    if (transaction.docChanged) changed()
  })
  vi.mocked(api.getRemoteProject).mockResolvedValue(remoteSnapshot('2'))
  try {
    await cloud.checkForUpdates('one', () => true)
    expect(changed).not.toHaveBeenCalled()
    expect(saving.state(editor).peek().dirty).toBe(false)
  } finally {
    unsubscribe()
  }
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
  vi.mocked(api.getRemoteProject).mockResolvedValue(
    remoteSnapshot('2', archive('other person’s edit'))
  )
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
  editor.dispatch({
    changes: {
      from: 0,
      insert: 'dirty ',
    },
  })
  projects.closeProject()
  vi.mocked(api.getRemoteProject).mockResolvedValue(
    remoteSnapshot('2', archive('remote edit'))
  )
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
  const router = registry.required(routerService)
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
      .get(editorAutosavePoliciesFacet)
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
    editor.dispatch({
      changes: {
        from: 0,
        insert: 'dirty ',
      },
    })
    vi.mocked(api.getRemoteProject).mockResolvedValue(
      remoteSnapshot('2', archive('remote edit'))
    )
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
async function openCloudShell() {
  const opened = await setup(true)
  registry.required(routerService).setLocation({
    pathname: '/project/one',
    search: '',
    hash: '',
    state: null,
    key: 'test',
  })
  await vi.waitFor(() =>
    expect(
      registry
        .get(editorAutosavePoliciesFacet)
        .find((policy) => policy.id === 'cloud.autosave')?.required.value
    ).toBe(true)
  )
  const { editors, editor } = opened
  const code = codeSurface(editors, editor)
  render(
    <>
      <CloudProjectStatus
        app={{
          registry,
        }}
        className=""
      />
      <EditorsPane
        editors={editors}
        indicators={registry.observe(editorTabIndicatorsFacet)}
        layout={{
          id: 'editors',
          label: 'Editors',
          type: LayoutType.Simple,
          areaType: 'editors',
        }}
      />
    </>
  )
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout'],
  })
  return {
    ...opened,
    code,
  }
}
it('autosaves cloud edits, adopts a conflicting remote write, and reopens the accepted contents', async () => {
  const { editor, saving } = await openCloudShell()
  vi.mocked(api.updateRemoteProject).mockImplementationOnce(
    async ({ files }) => {
      const uploaded = files.map(({ relativePath, data }) => ({
        relativePath,
        data: new Uint8Array(data),
      }))
      const saved = remoteSnapshot('2', uploaded)
      vi.mocked(api.getRemoteProject).mockResolvedValue(saved)
      vi.mocked(parseProjectArchive).mockResolvedValue(uploaded)
      return saved
    }
  )
  act(() => {
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'local edit',
      },
    })
  })
  expect(
    screen.getByRole('img', {
      name: 'Unsaved changes',
    })
  ).toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EDITOR_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() =>
      expect(saving.state(editor).peek().dirty).toBe(false)
    )
  })
  expect(api.updateRemoteProject).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: '1',
      files: expect.arrayContaining([file('main.kcl', 'local edit')]),
    })
  )
  expect(
    screen.queryByRole('img', {
      name: 'Unsaved changes',
    })
  ).not.toBeInTheDocument()
  const remote = archive('remote edit')
  vi.mocked(api.getRemoteProject).mockResolvedValue(remoteSnapshot('3', remote))
  vi.mocked(parseProjectArchive).mockResolvedValue(remote)
  vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
    new api.CloudApiError(409, 'Revision changed')
  )
  act(() => {
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'conflicting local edit',
      },
    })
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EDITOR_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(editor.contents.peek()).toBe('remote edit'))
  })
  expect(saving.state(editor).peek()).toMatchObject({
    dirty: false,
    saving: false,
    error: undefined,
  })
  expect(
    screen.queryByRole('img', {
      name: 'Unsaved changes',
    })
  ).not.toBeInTheDocument()
  const updates = vi.mocked(api.updateRemoteProject).mock.calls
  expect(updates).toHaveLength(2)
  expect(updates[1][0]).toMatchObject({
    expectedRevision: '2',
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EDITOR_SAVE_DEBOUNCE_MS)
  })
  expect(api.updateRemoteProject).toHaveBeenCalledTimes(2)
  cleanup()
  stop()
  await registry.dispose()
  await fileServices.dispose()
  await cloudServices.dispose()
  const reopened = await setup()
  expect(reopened.editor.contents.peek()).toBe('remote edit')
  expect(reopened.saving.state(reopened.editor).peek().dirty).toBe(false)
})
it('shows offline status, blocks Code edits, and autosaves the pending cloud edit after reconnecting', async () => {
  const { editor, code, saving } = await openCloudShell()
  act(() => {
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'pending edit',
      },
    })
  })
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await act(async () => {
    window.dispatchEvent(new Event('offline'))
  })
  expect(screen.getByRole('status')).toHaveTextContent('Offline')
  expect(
    screen.getByRole('tab', {
      name: /main.kcl/,
    })
  ).toHaveTextContent('Read-only')
  expect(code.contentDOM).toHaveAttribute('contenteditable', 'false')
  act(() => {
    code.dispatch({
      changes: {
        from: 0,
        insert: 'blocked edit',
      },
    })
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EDITOR_SAVE_DEBOUNCE_MS * 2)
  })
  expect(editor.contents.peek()).toBe('pending edit')
  expect(code.state.doc.toString()).toBe('pending edit')
  expect(api.updateRemoteProject).not.toHaveBeenCalled()
  expect(saving.state(editor).peek().dirty).toBe(true)
  online.mockReturnValue(true)
  await act(async () => {
    window.dispatchEvent(new Event('online'))
  })
  expect(code.contentDOM).toHaveAttribute('contenteditable', 'true')
  expect(
    screen.getByRole('tab', {
      name: /main.kcl/,
    })
  ).not.toHaveTextContent('Read-only')
  expect(
    screen.queryByText('Offline', {
      exact: true,
    })
  ).not.toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EDITOR_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() =>
      expect(saving.state(editor).peek().dirty).toBe(false)
    )
  })
  expect(api.updateRemoteProject).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      expectedRevision: '1',
      files: expect.arrayContaining([file('main.kcl', 'pending edit')]),
    })
  )
  expect(
    screen.queryByRole('img', {
      name: 'Unsaved changes',
    })
  ).not.toBeInTheDocument()
})
