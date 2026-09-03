import 'fake-indexeddb/auto'
import type * as ClientErrorsModule from '@src/lib/clientErrors'
import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  filterCloudSyncProjectFilesForSync,
  notifyCloudSyncRemoveMutation,
  notifyCloudSyncRenameMutation,
  notifyCloudSyncWriteLikeMutation,
  type ProjectArchiveFile,
  retryCloudSync,
  setCloudSyncOpenedProject,
} from '@src/lib/cloudSync'
import { projectManifestFromFiles } from '@src/lib/cloudSync/projectArchive'
import {
  appendOutboxEntry,
  getAllOutboxEntries,
  getProjectMetadata,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import {
  createCloudSyncTestFs,
  deleteCloudSyncTestDatabase,
  getFetchMethod,
  getFetchUrl,
  jsonResponse,
} from '@src/lib/cloudSync/testUtils'
import {
  PROJECT_FOLDER,
  PROJECT_IMAGE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
} from '@src/lib/projectLibraries'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clientErrorsMock = vi.hoisted(() => ({
  reportClientError: vi.fn(),
}))

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return {
    ...actual,
    reportClientError: clientErrorsMock.reportClientError,
  }
})

const encoder = new TextEncoder()
const baseUrl = 'https://example.test'
const projectDirectory = '/documents/Projects'
const projectPath = `${projectDirectory}/bracket`
const remoteProjectId = 'remote-project-123'
const remoteRevision = 'revision-123'
const remoteProjectUrl = `${baseUrl}/user/projects/${remoteProjectId}`
const projectToml = `title = "Bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`

const fetchMock = vi.fn<typeof fetch>()

function projectFile(relativePath: string, contents = ''): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

function installFetchMock() {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = getFetchUrl(input)
    const method = getFetchMethod(input, init)

    if (url === `${baseUrl}/user/projects` && method === 'GET') {
      return jsonResponse([])
    }

    if (url === remoteProjectUrl && method === 'GET') {
      return jsonResponse({
        id: remoteProjectId,
        title: 'Bracket',
        revision: remoteRevision,
      })
    }

    if (url.endsWith('/user/client-errors') && method === 'POST') {
      return jsonResponse({})
    }

    return jsonResponse({ message: `Unexpected fetch: ${method} ${url}` }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function cleanBaseManifest() {
  return projectManifestFromFiles(
    filterCloudSyncProjectFilesForSync([
      projectFile('main.kcl', 'cube = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
      projectFile('.gitignore', 'scratch.txt\nnested/local.txt\n'),
    ])
  )
}

describe('cloud sync file policy', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
    installFetchMock()
  })

  afterEach(async () => {
    setCloudSyncOpenedProject(undefined)
    configureCloudSyncEngine({ enabled: false })
    clientErrorsMock.reportClientError.mockClear()
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('does not infer a top-level cloud-library file as a project root', async () => {
    const topLevelFilePath = `${projectDirectory}/main.kcl`
    const files = new Map([[topLevelFilePath, 'cube = 1\n']])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })

    await notifyCloudSyncWriteLikeMutation(topLevelFilePath)

    expect(await getProjectMetadata(topLevelFilePath)).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('records nested cloud-library file mutations at the owning project root', async () => {
    const nestedFilePath = `${projectPath}/nested/part.kcl`
    const files = new Map([
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, `title = "Bracket"\n`],
      [nestedFilePath, 'cube = 1\n'],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })

    await notifyCloudSyncWriteLikeMutation(nestedFilePath)

    await expect(getProjectMetadata(projectPath)).resolves.toMatchObject({
      localProjectPath: projectPath,
      projectName: 'bracket',
    })
    await expect(
      getProjectMetadata(`${projectPath}/nested`)
    ).resolves.toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('records nested mutations under the owning cloud library when multiple cloud libraries are configured', async () => {
    const teamProjectDirectory = '/cloud/team'
    const teamProjectPath = `${teamProjectDirectory}/team-bracket`
    const nestedFilePath = `${teamProjectPath}/nested/part.kcl`
    const files = new Map([
      [
        `${teamProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        `title = "Team bracket"\n`,
      ],
      [nestedFilePath, 'cube = 1\n'],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory, teamProjectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })

    await notifyCloudSyncWriteLikeMutation(nestedFilePath)

    await expect(getProjectMetadata(teamProjectPath)).resolves.toMatchObject({
      localProjectPath: teamProjectPath,
      projectName: 'team-bracket',
    })
    await expect(
      getProjectMetadata(`${teamProjectPath}/nested`)
    ).resolves.toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('does not infer directory-library projects from legacy project folder names', async () => {
    const cloudProjectDirectory = '/cloud/personal'
    const directoryLibraryPath = `/documents/${PROJECT_FOLDER}`
    const directoryProjectPath = `${directoryLibraryPath}/local-only-project`
    const files = new Map([
      [`${directoryProjectPath}/main.kcl`, 'cube = 1\n'],
      [
        `${directoryProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        `title = "Local only project"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory: cloudProjectDirectory })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [cloudProjectDirectory],
      autoEnrollCloudLibraryProjects: true,
    })

    await notifyCloudSyncWriteLikeMutation(`${directoryProjectPath}/main.kcl`)

    expect(await getProjectMetadata(directoryProjectPath)).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => getFetchMethod(input, init) === 'POST'
      )
    ).toBe(false)
  })

  it('does not create metadata for unlinked directory-library projects in a scoped file route', async () => {
    const cloudProjectDirectory = '/cloud/personal'
    const directoryLibraryPath = '/documents/Projects'
    const directoryProjectPath = `${directoryLibraryPath}/local-only-project`
    const files = new Map([
      [`${directoryProjectPath}/main.kcl`, 'cube = 1\n'],
      [
        `${directoryProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        `title = "Local only project"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory: cloudProjectDirectory })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [cloudProjectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })
    setCloudSyncOpenedProject({
      projectPath: directoryProjectPath,
      libraryPath: directoryLibraryPath,
      libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
    })

    await notifyCloudSyncWriteLikeMutation(`${directoryProjectPath}/main.kcl`)

    expect(await getProjectMetadata(directoryProjectPath)).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('does not sync cloud-id projects opened outside every project library', async () => {
    const cloudProjectDirectory = '/cloud/personal'
    const externalProjectPath = '/Users/frank/Desktop/random-project'
    const files = new Map([
      [`${externalProjectPath}/main.kcl`, 'cube = 1\n'],
      [`${externalProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory: cloudProjectDirectory })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [cloudProjectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })
    setCloudSyncOpenedProject({
      projectPath: externalProjectPath,
    })

    await notifyCloudSyncWriteLikeMutation(`${externalProjectPath}/main.kcl`)

    expect(await getProjectMetadata(externalProjectPath)).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
    expect(
      fetchMock.mock.calls.some(([input]) =>
        getFetchUrl(input).startsWith(remoteProjectUrl)
      )
    ).toBe(false)
  })

  it('does not treat sibling paths as cloud-library projects by prefix match', async () => {
    const cloudProjectDirectory = '/cloud/personal'
    const siblingProjectPath = '/cloud/personal-archive/local-only-project'
    const files = new Map([
      [`${siblingProjectPath}/main.kcl`, 'cube = 1\n'],
      [
        `${siblingProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        `title = "Local only project"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, {
        projectDirectory: cloudProjectDirectory,
      })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [cloudProjectDirectory],
      autoEnrollCloudLibraryProjects: true,
    })

    await notifyCloudSyncWriteLikeMutation(`${siblingProjectPath}/main.kcl`)

    expect(await getProjectMetadata(siblingProjectPath)).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('moves cloud metadata when a project root is renamed inside the cloud library', async () => {
    const sourceProjectPath = `${projectDirectory}/old-bracket`
    const targetProjectPath = `${projectDirectory}/new-bracket`
    const files = new Map([
      [`${targetProjectPath}/main.kcl`, 'cube = 1\n'],
      [
        `${targetProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        `title = "New bracket"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: sourceProjectPath,
      projectName: 'old-bracket',
      remoteRevision,
      baseManifest: { files: {} },
    })
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })

    await notifyCloudSyncRenameMutation(sourceProjectPath, targetProjectPath)

    await expect(getProjectMetadata(sourceProjectPath)).resolves.toBeUndefined()
    await expect(getProjectMetadata(targetProjectPath)).resolves.toMatchObject({
      localProjectPath: targetProjectPath,
      projectName: 'new-bracket',
      remoteRevision,
      tombstone: false,
    })
    expect(await getAllOutboxEntries()).toMatchObject([
      {
        projectPath: targetProjectPath,
        kind: 'upsert',
        targetPath: targetProjectPath,
        sourcePath: sourceProjectPath,
      },
    ])
  })

  it('ignores project root renames that land outside the cloud library', async () => {
    const sourceProjectPath = `${projectDirectory}/old-bracket`
    const targetProjectPath = '/outside/new-bracket'
    const files = new Map([
      [`${targetProjectPath}/main.kcl`, 'cube = 1\n'],
      [
        `${targetProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        `title = "New bracket"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: sourceProjectPath,
      projectName: 'old-bracket',
      remoteRevision,
      baseManifest: { files: {} },
    })
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })

    await notifyCloudSyncRenameMutation(sourceProjectPath, targetProjectPath)

    await expect(getProjectMetadata(sourceProjectPath)).resolves.toMatchObject({
      localProjectPath: sourceProjectPath,
      projectName: 'old-bracket',
    })
    await expect(getProjectMetadata(targetProjectPath)).resolves.toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('does not enqueue mutations for ignored files or generated thumbnails', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'cube = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, `title = "Bracket"\n`],
      [`${projectPath}/.gitignore`, 'scratch.txt\n'],
      [`${projectPath}/scratch.txt`, 'ignored local note\n'],
      [`${projectPath}/nested/.gitignore`, 'local.txt\n'],
      [`${projectPath}/nested/local.txt`, 'ignored nested note\n'],
      [`${projectPath}/${PROJECT_IMAGE_NAME}`, 'generated thumbnail\n'],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })

    await notifyCloudSyncWriteLikeMutation(`${projectPath}/scratch.txt`)
    await notifyCloudSyncWriteLikeMutation(`${projectPath}/nested/local.txt`)
    await notifyCloudSyncWriteLikeMutation(
      `${projectPath}/${PROJECT_IMAGE_NAME}`
    )

    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('records acknowledged files removed by a local mutation', async () => {
    const obsoletePath = `${projectPath}/old/obsolete.kcl`
    const files = new Map([
      [`${projectPath}/main.kcl`, 'cube = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId,
      remoteRevision,
      baseManifest: await projectManifestFromFiles([
        projectFile('main.kcl', 'cube = 1\n'),
        projectFile('old/obsolete.kcl', 'obsolete = 1\n'),
        projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
      ]),
    })
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })

    await notifyCloudSyncRemoveMutation(obsoletePath)

    await expect(getAllOutboxEntries()).resolves.toMatchObject([
      {
        kind: 'upsert',
        projectPath,
        deletedPaths: ['old/obsolete.kcl'],
      },
    ])
  })

  it('clears ignored-file-only pending work without uploading a new revision', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'cube = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
      [`${projectPath}/.gitignore`, 'scratch.txt\nnested/local.txt\n'],
      [`${projectPath}/scratch.txt`, 'ignored local note changed\n'],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId,
      remoteRevision,
      remoteUpdatedAt: '2026-07-08T12:00:00.000Z',
      baseManifest: await cleanBaseManifest(),
    })
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: `${projectPath}/scratch.txt`,
      createdAt: '2026-07-08T12:01:00.000Z',
    })

    setCloudSyncOpenedProject({
      projectPath,
      libraryPath: projectDirectory,
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })
    retryCloudSync()

    await vi.waitFor(async () => {
      expect(await getAllOutboxEntries()).toEqual([])
    })
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => getFetchMethod(input, init) === 'PUT'
      )
    ).toBe(false)
  })
})
