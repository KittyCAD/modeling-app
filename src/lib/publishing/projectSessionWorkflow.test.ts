import '@src/lib/projectSession/next/testFeature'
import { Registry, provide, contribute } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import nodefs from '@src/lib/fs-zds/nodefs'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import type { Project } from '@src/lib/projectSession/next/types'
import { saveExtension } from '@src/lib/save/registry'
import {
  editorOnSaveFacet,
  editorSaveService,
} from '@src/lib/save/registry/contract'
import { createProjectSessionPublicationWorkflow } from '@src/lib/publishing/projectSessionWorkflow'
import type { CurrentProjectPublicationDetails } from '@src/lib/publishing/publication'
import type { CloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import type { ProjectArchiveFile } from '@src/lib/cloudProjects/runtime/types'
import { setProjectTitleInProjectTomlContents } from '@src/lib/projectTomlMetadata'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

const cleanup: (() => Promise<void>)[] = []
beforeAll(() =>
  moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
)
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose()
})
const submission = {
  title: 'Published bracket',
  description: 'Bracket',
  categoryIds: ['hardware'],
}

async function setup({ local = false, readWriteAccess = true } = {}) {
  const root = local ? '/projects/source' : '/cloud/source'
  const memory = createMemoryFileSystem(nodefs.impl)
  const scheduler = createFileOperationsScheduler(memory)
  const files = scheduler.operations
  await files.createDirectory(`${root}/parts`)
  await files.writeFile(`${root}/main.kcl`, 'width = 1')
  await files.writeFile(`${root}/parts/model.kcl`, 'height = 2')
  await files.writeFile(
    `${root}/project.toml`,
    'title = "Source"\ndefault_file = "main.kcl"\n'
  )
  await files.writeFile(`${root}/.gitignore`, 'ignored.kcl\n')
  await files.writeFile(`${root}/ignored.kcl`, 'private')
  const projects = createProjectSessionService(files)
  const project: Project = {
    contents: {
      name: 'source',
      path: root,
      children: [
        { name: 'project.toml', path: `${root}/project.toml`, children: null },
      ],
    },
    metadata: {
      title: 'Source',
      readWriteAccess,
      defaultFile: 'main.kcl',
    },
    ...(local
      ? {}
      : ({
          storage: { type: 'cloud', projectId: 'source' },
        } satisfies Partial<Project>)),
  }
  const session = projects.openProject(project)
  const registry = new Registry()
  const beforeSave = vi.fn(async (): Promise<undefined> => undefined)
  await registry.configure([
    provide(projectSessionService, projects),
    editorsExtension,
    saveExtension,
    contribute(editorOnSaveFacet, () => ({
      id: 'persist',
      matches: '*',
      onSave: async ({ src, contents }) => {
        await beforeSave()
        await files.writeFile(src, contents)
      },
    })),
  ])
  cleanup.push(async () => {
    projects.closeProject()
    await registry.dispose()
    await scheduler.dispose()
  })
  const editors = registry.required(editorsService)
  const saving = registry.required(editorSaveService)
  const main = requireSuccess(
    editors.openEditor(`${root}/main.kcl`, 'width = 1')
  )
  const other = requireSuccess(
    editors.openEditor(`${root}/parts/model.kcl`, 'height = 2')
  )
  let archive: ProjectArchiveFile[] = []
  const cloud = {
    pathFor: (id: string) => `/cloud/${id}`,
    createProject: vi.fn(
      async (_title: string, files: readonly ProjectArchiveFile[]) => {
        archive = [...files]
        return { id: 'copy', path: '/cloud/copy' }
      }
    ),
    renameProject: vi.fn(async (_id: string, title: string) => {
      await files.writeFile(
        `${root}/project.toml`,
        setProjectTitleInProjectTomlContents(
          await session.files.read('project.toml'),
          title
        )
      )
    }),
    publishProject: vi.fn(
      async (_args: Parameters<CloudStorageService['publishProject']>[0]) => ({
        remoteProjectId: local ? 'copy' : 'source',
      })
    ),
    getPublicationDetails: vi.fn(
      async ({
        projectId,
        fallbackTitle,
      }: {
        projectId: string
        fallbackTitle: string
      }): Promise<CurrentProjectPublicationDetails> => ({
        projectId,
        title: fallbackTitle,
        publicationStatus: 'pending_review',
        description: '',
        categoryIds: [],
        updatedAt: '2026-11-21',
      })
    ),
  }
  const openCloudProject = vi.fn(async (_id: string) => {})
  const validate = vi.fn(
    async (_files: ProjectArchiveFile[]): Promise<Error | undefined> =>
      undefined
  )
  const workflow = createProjectSessionPublicationWorkflow({
    session,
    editors,
    saving,
    cloud,
    fileOperations: files,
    token: 'token',
    isCurrent: () => projects.currentSession.peek() === session,
    updateMetadata: projects.updateMetadata,
    openCloudProject,
    validate,
  })
  return {
    workflow,
    files,
    root,
    projects,
    session,
    project,
    editors,
    saving,
    main,
    other,
    cloud,
    beforeSave,
    openCloudProject,
    validate,
    archive: () => archive,
  }
}

it('saves every project buffer and keeps the open config coherent with the published title', async () => {
  const t = await setup()
  t.main.dispatch({
    changes: {
      from: 0,
      to: t.main.contents.peek().length,
      insert: 'width = 3',
    },
  })
  t.other.dispatch({
    changes: {
      from: 0,
      to: t.other.contents.peek().length,
      insert: 'height = 4',
    },
  })
  const config = requireSuccess(
    t.editors.openEditor(
      `${t.root}/project.toml`,
      await t.session.files.read('project.toml')
    )
  )
  const outside = requireSuccess(
    t.editors.openEditor('/outside/note.md', 'untouched')
  )
  outside.dispatch({ changes: { from: 0, insert: 'changed ' } })
  const result = await t.workflow.submit(submission)
  expect(result).toEqual(
    expect.objectContaining({ published: { remoteProjectId: 'source' } })
  )
  expect(await t.session.files.read('main.kcl')).toBe('width = 3')
  expect(await t.session.files.read('parts/model.kcl')).toBe('height = 4')
  expect(await t.files.exists('/outside/note.md')).toBe(false)
  expect(t.cloud.publishProject).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: 'source' })
  )
  expect(t.session.project.peek().metadata.title).toBe('Published bracket')
  expect(config.contents.peek()).toContain('Published bracket')
  expect(t.saving.state(config).peek().dirty).toBe(false)
  expect(t.cloud.createProject).not.toHaveBeenCalled()
})

it('creates a cloud snapshot with nested edits and exclusions without retitling the local source', async () => {
  const t = await setup({ local: true })
  t.other.dispatch({
    changes: {
      from: 0,
      to: t.other.contents.peek().length,
      insert: 'height = 9',
    },
  })
  t.openCloudProject.mockImplementation(async () => {
    t.projects.closeProject()
  })
  const result = await t.workflow.submit(submission)
  expect(result).toEqual(
    expect.objectContaining({ published: { remoteProjectId: 'copy' } })
  )
  expect(t.archive().map((file) => file.relativePath)).toEqual([
    '.gitignore',
    'main.kcl',
    'parts/model.kcl',
    'project.toml',
  ])
  expect(
    new TextDecoder().decode(
      t.archive().find((file) => file.relativePath === 'parts/model.kcl')?.data
    )
  ).toBe('height = 9')
  expect(await t.session.files.read('project.toml')).toContain('Source')
  expect(t.cloud.renameProject).not.toHaveBeenCalled()
  expect(t.openCloudProject).toHaveBeenCalledWith('copy')
  expect(t.cloud.publishProject).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: 'copy' })
  )
})

it('does not retarget a save or publish after the project switches', async () => {
  const t = await setup({ local: true })
  t.main.dispatch({
    changes: {
      from: 0,
      to: t.main.contents.peek().length,
      insert: 'width = 3',
    },
  })
  const gate = Promise.withResolvers<undefined>()
  t.beforeSave.mockImplementation(() => gate.promise)
  const pending = t.workflow.submit(submission)
  await vi.waitFor(() => expect(t.beforeSave).toHaveBeenCalled())
  t.projects.openProject({
    ...t.project,
    contents: { name: 'other', path: '/other', children: [] },
  })
  gate.resolve(undefined)
  await expect(pending).resolves.toBeInstanceOf(Error)
  expect(t.cloud.createProject).not.toHaveBeenCalled()
  expect(t.cloud.publishProject).not.toHaveBeenCalled()
  expect(await t.files.exists('/other/main.kcl')).toBe(false)
})

it('keeps later typing dirty and stops preparation', async () => {
  const t = await setup({ local: true })
  t.main.dispatch({
    changes: {
      from: 0,
      to: t.main.contents.peek().length,
      insert: 'width = 3',
    },
  })
  const gate = Promise.withResolvers<undefined>()
  t.beforeSave.mockImplementation(() => gate.promise)
  const pending = t.workflow.submit(submission)
  await vi.waitFor(() => expect(t.beforeSave).toHaveBeenCalled())
  t.main.dispatch({ changes: { from: 0, insert: 'later ' } })
  gate.resolve(undefined)
  await expect(pending).resolves.toBeInstanceOf(Error)
  expect(t.saving.state(t.main).peek().dirty).toBe(true)
  expect(t.main.contents.peek()).toBe('later width = 3')
  expect(t.cloud.createProject).not.toHaveBeenCalled()
})

it('rejects unnamed buffers and invalid archives before creating a cloud copy', async () => {
  const t = await setup({ local: true })
  const unnamed = requireSuccess(t.editors.createEditor('unsaved'))
  await expect(t.workflow.submit(submission)).resolves.toEqual(
    expect.objectContaining({ message: expect.stringContaining('unnamed') })
  )
  t.editors.closeEditor(unnamed.id)
  t.validate.mockResolvedValue(new Error('Invalid KCL'))
  await expect(t.workflow.submit(submission)).resolves.toEqual(
    expect.objectContaining({ message: 'Invalid KCL' })
  )
  expect(t.cloud.createProject).not.toHaveBeenCalled()
  expect(t.cloud.publishProject).not.toHaveBeenCalled()
})

it('finishes a captured copy without redirecting a newer project', async () => {
  const t = await setup({ local: true })
  const copy = Promise.withResolvers<{ id: string; path: string }>()
  t.cloud.createProject.mockImplementation(() => copy.promise)
  const pending = t.workflow.submit(submission)
  await vi.waitFor(() => expect(t.cloud.createProject).toHaveBeenCalled())
  t.projects.closeProject()
  copy.resolve({ id: 'copy', path: '/cloud/copy' })
  await expect(pending).resolves.toEqual(
    expect.objectContaining({ published: { remoteProjectId: 'copy' } })
  )
  expect(t.openCloudProject).not.toHaveBeenCalled()
  expect(t.cloud.publishProject).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: 'copy' })
  )
})

it('does not save or publish a read-only opening', async () => {
  const t = await setup({ local: true, readWriteAccess: false })
  await expect(t.workflow.submit(submission)).resolves.toEqual(
    expect.objectContaining({ message: 'This project is read-only.' })
  )
  expect(t.beforeSave).not.toHaveBeenCalled()
  expect(t.cloud.createProject).not.toHaveBeenCalled()
})

it('uses newer stored contents without rewriting a clean editor buffer', async () => {
  const t = await setup({ local: true })
  await t.files.writeFile(`${t.root}/main.kcl`, 'width = 99')
  await expect(t.workflow.submit(submission)).resolves.toEqual(
    expect.objectContaining({ published: { remoteProjectId: 'copy' } })
  )
  expect(t.beforeSave).not.toHaveBeenCalled()
  expect(
    new TextDecoder().decode(
      t.archive().find((file) => file.relativePath === 'main.kcl')?.data
    )
  ).toBe('width = 99')
  expect(await t.session.files.read('main.kcl')).toBe('width = 99')
})

it('preserves an ignored manifest for validation instead of replacing malformed contents', async () => {
  const t = await setup({ local: true })
  await t.files.writeFile(`${t.root}/.gitignore`, 'project.toml\n')
  await t.session.files.write('project.toml', '[')
  t.validate.mockImplementation(async (files) => {
    const config = files.find((file) => file.relativePath === 'project.toml')
    return new TextDecoder().decode(config?.data) === '['
      ? new Error('Invalid manifest')
      : undefined
  })
  await expect(t.workflow.submit(submission)).resolves.toEqual(
    expect.objectContaining({ message: 'Invalid manifest' })
  )
  expect(t.cloud.createProject).not.toHaveBeenCalled()
  expect(await t.session.files.read('project.toml')).toBe('[')
})

it('does not publish unresolved buffers that disagree about the same file', async () => {
  const t = await setup({ local: true })
  const duplicate = requireSuccess(
    t.editors.openEditor(`${t.root}/main.kcl`, 'width = 1')
  )
  t.main.dispatch({
    changes: {
      from: 0,
      to: t.main.contents.peek().length,
      insert: 'width = 3',
    },
  })
  duplicate.dispatch({
    changes: {
      from: 0,
      to: duplicate.contents.peek().length,
      insert: 'width = 4',
    },
  })
  await expect(t.workflow.submit(submission)).resolves.toBeInstanceOf(Error)
  expect(t.cloud.createProject).not.toHaveBeenCalled()
  expect(t.main.contents.peek()).toBe('width = 3')
  expect(duplicate.contents.peek()).toBe('width = 4')
})
