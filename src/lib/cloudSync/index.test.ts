import {
  filterCloudSyncProjectFilesForSync,
  getCloudSyncAutoReconciledProjectFiles,
  getCloudSyncInitialLocalProjectSyncAction,
  getCloudSyncKnownLocalRemoteIndexAction,
  getCloudSyncMissingRemoteProjectAction,
  getCloudSyncProjectApiThrottleDelayMs,
  getCloudSyncProjectModifiedTime,
  getCloudSyncProjectRootInDirectories,
  getCloudSyncProjectRootInDirectory,
  getCloudSyncProjectSyncPreflightAction,
  getCloudSyncRemoteArchiveReconciliationAction,
  getCloudSyncRemoteIndexAction,
  getCloudSyncRetryDelayMs,
  getCloudSyncScopePlan,
  type OutboxEntry,
  type ProjectArchiveFile,
  type ProjectManifest,
  prepareProjectFilesForCloudUpload,
  projectManifestsEqual,
  shouldAutoEnrollCloudLibraryProject,
  shouldScheduleCloudSyncPendingWork,
  shouldThrottleCloudSyncProjectApiRequests,
} from '@src/lib/cloudSync'
import {
  getCloudProjectLibraryMaterializationDirectoryPath,
  isCloudSyncExcludedPath,
} from '@src/lib/cloudSync/paths'
import {
  getProjectArchiveEntrypointPath,
  normalizeProjectArchiveFilesForCloudSync,
  projectManifestFromFiles,
  withRemoteProjectMetadataInArchiveFiles,
} from '@src/lib/cloudSync/projectArchive'
import {
  PROJECT_FOLDER,
  PROJECT_IMAGE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  LEGACY_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH,
} from '@src/lib/projectLibraries'
import { afterEach, describe, expect, it, vi } from 'vitest'

const encoder = new TextEncoder()

afterEach(() => {
  vi.restoreAllMocks()
})

function projectFile(relativePath: string, contents = ''): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

function readProjectFile(files: ProjectArchiveFile[], relativePath: string) {
  return new TextDecoder().decode(
    files.find((file) => file.relativePath === relativePath)?.data
  )
}

describe('cloudSync sync helpers', () => {
  it('uses a configured cloud library path as its materialization directory', async () => {
    await expect(
      getCloudProjectLibraryMaterializationDirectoryPath({
        path: '/team-cloud/',
        type: 'cloud',
      })
    ).resolves.toBe('/team-cloud')
  })

  it('resolves the legacy personal cloud library path to the app-managed materialization directory', async () => {
    vi.spyOn(fsZds, 'getPath').mockResolvedValue('/documents')
    vi.spyOn(fsZds, 'join').mockImplementation((...parts) =>
      parts.reduce((targetPath, part) => `${targetPath}/${part}`)
    )

    await expect(
      getCloudProjectLibraryMaterializationDirectoryPath({
        path: LEGACY_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH,
        type: 'cloud',
      })
    ).resolves.toBe(`/documents/${PROJECT_FOLDER}`)

    expect(fsZds.getPath).toHaveBeenCalledTimes(1)
    expect(fsZds.getPath).toHaveBeenCalledWith('documents')
  })

  it('rejects non-cloud libraries as cloud materialization sources', async () => {
    await expect(
      getCloudProjectLibraryMaterializationDirectoryPath({
        path: '/projects',
        type: 'directory',
      })
    ).rejects.toThrow('Expected a cloud project library.')
  })

  it('identifies the owning project root beneath a cloud library root', () => {
    expect(
      getCloudSyncProjectRootInDirectory(
        '/cloud/personal/bracket/main.kcl',
        '/cloud/personal'
      )
    ).toBe('/cloud/personal/bracket')

    expect(
      getCloudSyncProjectRootInDirectory(
        '/cloud/personal/bracket/nested/part.kcl',
        '/cloud/personal'
      )
    ).toBe('/cloud/personal/bracket')

    expect(
      getCloudSyncProjectRootInDirectory(
        '/cloud/personal/bracket/',
        '/cloud/personal'
      )
    ).toBe('/cloud/personal/bracket')
  })

  it('does not infer project roots outside the owning cloud library root', () => {
    expect(
      getCloudSyncProjectRootInDirectory('/cloud/personal', '/cloud/personal')
    ).toBeUndefined()

    expect(
      getCloudSyncProjectRootInDirectory(
        '/cloud/personal-archive/bracket/main.kcl',
        '/cloud/personal'
      )
    ).toBeUndefined()

    expect(
      getCloudSyncProjectRootInDirectory(
        '/documents/zoo-design-studio-projects/bracket/main.kcl',
        '/cloud/personal'
      )
    ).toBeUndefined()
  })

  it('normalizes path separators before finding the cloud-library project root', () => {
    expect(
      getCloudSyncProjectRootInDirectory(
        '\\cloud\\personal\\bracket\\main.kcl',
        '\\cloud\\personal\\'
      )
    ).toBe('/cloud/personal/bracket')
  })

  it('uses the most specific owning cloud library root when multiple roots match', () => {
    expect(
      getCloudSyncProjectRootInDirectories('/cloud/team/bracket/main.kcl', [
        '/cloud',
        '/cloud/team',
      ])
    ).toBe('/cloud/team/bracket')

    expect(
      getCloudSyncProjectRootInDirectories('/cloud/personal/bracket/main.kcl', [
        '/cloud/team',
        '/cloud/personal',
      ])
    ).toBe('/cloud/personal/bracket')
  })

  it('compares manifests by path, size, and content hash without depending on object key order', () => {
    const left: ProjectManifest = {
      files: {
        'main.kcl': { byteSize: 10, sha256: 'a' },
        'nested/part.kcl': { byteSize: 20, sha256: 'b' },
      },
    }
    const right: ProjectManifest = {
      files: {
        'nested/part.kcl': { byteSize: 20, sha256: 'b' },
        'main.kcl': { byteSize: 10, sha256: 'a' },
      },
    }
    const changed: ProjectManifest = {
      files: {
        'main.kcl': { byteSize: 10, sha256: 'a' },
        'nested/part.kcl': { byteSize: 21, sha256: 'b' },
      },
    }

    expect(projectManifestsEqual(left, right)).toBe(true)
    expect(projectManifestsEqual(left, changed)).toBe(false)
    expect(projectManifestsEqual(left, undefined)).toBe(false)
  })

  it('auto-reconciles independent local and remote file changes from the sync base', async () => {
    const baseFiles = [
      projectFile('main.kcl', 'base = 1\n'),
      projectFile('obsolete.kcl', 'delete me\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, 'title = "Demo"\n'),
    ]
    const localFiles = [
      projectFile('main.kcl', 'local = 2\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, 'title = "Demo"\n'),
    ]
    const remoteFiles = [
      projectFile('main.kcl', 'base = 1\n'),
      projectFile('obsolete.kcl', 'delete me\n'),
      projectFile('remote.kcl', 'cloud = 2\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, 'title = "Demo"\n'),
    ]

    const mergedFiles = getCloudSyncAutoReconciledProjectFiles({
      baseManifest: await projectManifestFromFiles(baseFiles),
      localFiles,
      localManifest: await projectManifestFromFiles(localFiles),
      remoteFiles,
      remoteManifest: await projectManifestFromFiles(remoteFiles),
    })

    expect(mergedFiles?.map((file) => file.relativePath)).toEqual([
      'main.kcl',
      'project.toml',
      'remote.kcl',
    ])
    expect(readProjectFile(mergedFiles ?? [], 'main.kcl')).toBe('local = 2\n')
    expect(readProjectFile(mergedFiles ?? [], 'remote.kcl')).toBe('cloud = 2\n')
  })

  it('keeps same-path divergent local and remote changes in the conflict flow', async () => {
    const baseFiles = [projectFile('main.kcl', 'base = 1\n')]
    const localFiles = [projectFile('main.kcl', 'local = 2\n')]
    const remoteFiles = [projectFile('main.kcl', 'cloud = 2\n')]

    expect(
      getCloudSyncAutoReconciledProjectFiles({
        baseManifest: await projectManifestFromFiles(baseFiles),
        localFiles,
        localManifest: await projectManifestFromFiles(localFiles),
        remoteFiles,
        remoteManifest: await projectManifestFromFiles(remoteFiles),
      })
    ).toBeUndefined()
  })

  it('includes API-required entrypoint and project.toml paths in project upload metadata', () => {
    const payload = prepareProjectFilesForCloudUpload('/projects/bracket', [
      projectFile('nested/part.kcl'),
      projectFile(
        PROJECT_SETTINGS_FILE_NAME,
        'title = "Bracket"\ndefault_file = "nested/part.kcl"\n'
      ),
    ])

    expect(payload.body).toMatchObject({
      title: 'Bracket',
      entrypoint_path: 'nested/part.kcl',
      project_toml_path: PROJECT_SETTINGS_FILE_NAME,
    })
    expect(payload.files.map((file) => file.relativePath)).toEqual([
      'nested/part.kcl',
      PROJECT_SETTINGS_FILE_NAME,
    ])
  })

  it('adds a project.toml upload file without default_file when local project settings are missing', () => {
    const payload = prepareProjectFilesForCloudUpload('/projects/bracket', [
      projectFile('main.kcl'),
    ])
    const projectToml = new TextDecoder().decode(
      payload.files.find(
        (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
      )?.data
    )

    expect(payload.body.entrypoint_path).toBe('main.kcl')
    expect(payload.body.project_toml_path).toBe(PROJECT_SETTINGS_FILE_NAME)
    expect(payload.files.map((file) => file.relativePath)).toEqual([
      'main.kcl',
      PROJECT_SETTINGS_FILE_NAME,
    ])
    expect(projectToml).toContain('title = "bracket"')
    expect(projectToml).not.toContain('default_file')
  })

  it('adds the upload title to project.toml when local project settings have no title', () => {
    const payload = prepareProjectFilesForCloudUpload('/projects/bracket', [
      projectFile('main.kcl'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, 'default_file = "main.kcl"\n'),
    ])
    const projectToml = new TextDecoder().decode(
      payload.files.find(
        (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
      )?.data
    )

    expect(payload.body.title).toBe('bracket')
    expect(projectToml).toContain('default_file = "main.kcl"')
    expect(projectToml).toContain('title = "bracket"')
  })

  it('uses API entrypoint metadata for uploads without writing default_file into project.toml', () => {
    const payload = prepareProjectFilesForCloudUpload(
      '/projects/bracket',
      [
        projectFile('main.kcl'),
        projectFile('nested/part.kcl'),
        projectFile(PROJECT_SETTINGS_FILE_NAME, 'title = "Bracket"\n'),
      ],
      { entrypointPath: 'nested/part.kcl' }
    )
    const projectToml = new TextDecoder().decode(
      payload.files.find(
        (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
      )?.data
    )

    expect(payload.body.entrypoint_path).toBe('nested/part.kcl')
    expect(projectToml).toContain('title = "Bracket"')
    expect(projectToml).not.toContain('default_file')
  })

  it('preserves project.toml bytes before cloud sync upload and manifest hashing', async () => {
    const localProjectToml =
      'title = "demo-project"\ndefault_file = "main.kcl"\n\n[settings.meta]\nid = "settings-id"\n\n[settings.app]\n[settings.modeling]\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n'
    const cloudProjectToml =
      'default_file = "main.kcl"\ntitle = "demo-project"\n\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n\n[settings.app]\n[settings.meta]\nid = "settings-id"\n\n[settings.modeling]\n'
    const localOrderFiles = normalizeProjectArchiveFilesForCloudSync([
      projectFile('main.kcl', 'cube = 1'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, localProjectToml),
    ])
    const cloudOrderFiles = normalizeProjectArchiveFilesForCloudSync([
      projectFile('main.kcl', 'cube = 1'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, cloudProjectToml),
    ])
    const uploadPayload = prepareProjectFilesForCloudUpload(
      '/projects/demo-project',
      cloudOrderFiles
    )

    expect(readProjectFile(localOrderFiles, PROJECT_SETTINGS_FILE_NAME)).toBe(
      localProjectToml
    )
    expect(
      readProjectFile(uploadPayload.files, PROJECT_SETTINGS_FILE_NAME)
    ).toBe(cloudProjectToml)
    expect(
      projectManifestsEqual(
        await projectManifestFromFiles(localOrderFiles),
        await projectManifestFromFiles(cloudOrderFiles)
      )
    ).toBe(false)
  })

  it('adds an Untitled project.toml title when remote project metadata has no title', () => {
    const files = withRemoteProjectMetadataInArchiveFiles(
      [projectFile('main.kcl')],
      undefined,
      'remote-project-123',
      'dev.zoo.dev'
    )
    const projectToml = new TextDecoder().decode(
      files.find((file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME)
        ?.data
    )

    expect(projectToml).toContain('title = "Untitled"')
    expect(projectToml).not.toContain('default_file')
    expect(projectToml).toContain('project_id = "remote-project-123"')
  })

  it('does not write project.toml default_file from remote entrypoint metadata', () => {
    const files = withRemoteProjectMetadataInArchiveFiles(
      [
        projectFile('main.kcl'),
        projectFile('nested/part.kcl'),
        projectFile(PROJECT_SETTINGS_FILE_NAME, 'title = "Bracket"\n'),
      ],
      'Bracket',
      'remote-project-123',
      'dev.zoo.dev'
    )
    const projectToml = new TextDecoder().decode(
      files.find((file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME)
        ?.data
    )

    expect(getProjectArchiveEntrypointPath(files, 'nested/part.kcl')).toBe(
      'nested/part.kcl'
    )
    expect(projectToml).toContain('title = "Bracket"')
    expect(projectToml).not.toContain('default_file')
    expect(projectToml).toContain('project_id = "remote-project-123"')
  })

  it('excludes files ignored by project .gitignore from cloud sync manifests and uploads', () => {
    const files = filterCloudSyncProjectFilesForSync([
      projectFile('main.kcl', 'cube = 1'),
      projectFile('.gitignore', `${PROJECT_IMAGE_NAME}\ndist/\n`),
      projectFile(PROJECT_IMAGE_NAME, 'generated image'),
      projectFile('dist/generated.kcl', 'ignored = 1'),
      projectFile('nested/.gitignore', 'local.txt\n'),
      projectFile('nested/local.txt', 'ignored nested note'),
      projectFile('nested/part.kcl', 'part = 1'),
    ])

    expect(files.map((file) => file.relativePath)).toEqual([
      'main.kcl',
      '.gitignore',
      'nested/.gitignore',
      'nested/part.kcl',
    ])
  })

  it('excludes generated thumbnails from cloud sync manifests and uploads', () => {
    const files = filterCloudSyncProjectFilesForSync([
      projectFile('main.kcl', 'cube = 1'),
      projectFile(PROJECT_IMAGE_NAME, 'generated image'),
    ])

    expect(files.map((file) => file.relativePath)).toEqual(['main.kcl'])
  })

  it('excludes VCS metadata from cloud sync manifests without .gitignore entries', () => {
    expect(isCloudSyncExcludedPath('.git')).toBe(true)
    expect(isCloudSyncExcludedPath('.git/objects/pack.idx')).toBe(true)
    expect(isCloudSyncExcludedPath('nested/.git/HEAD')).toBe(true)
    expect(isCloudSyncExcludedPath('.gitignore')).toBe(false)
    expect(isCloudSyncExcludedPath('.github/workflows/test.yml')).toBe(false)

    const files = filterCloudSyncProjectFilesForSync([
      projectFile('main.kcl', 'cube = 1'),
      projectFile('.git/HEAD', 'ref: refs/heads/main\n'),
      projectFile('.git/objects/pack/pack-123.idx', 'pack index'),
      projectFile('.gitignore', 'dist/\n'),
      projectFile('.github/workflows/test.yml', 'name: test\n'),
      projectFile('.hg/store/data', 'hg data'),
      projectFile('.svn/entries', 'svn entries'),
      projectFile('.jj/repo/store/git/HEAD', 'jj data'),
    ])

    expect(files.map((file) => file.relativePath)).toEqual([
      'main.kcl',
      '.gitignore',
      '.github/workflows/test.yml',
    ])
  })

  it('includes expected revisions in guarded project update uploads', () => {
    const payload = prepareProjectFilesForCloudUpload(
      '/projects/bracket',
      [projectFile('main.kcl')],
      'revision-123'
    )

    expect(payload.body.expected_revision).toBe('revision-123')
  })

  it('uses the local project.toml title for renamed cloud project uploads', () => {
    const payload = prepareProjectFilesForCloudUpload(
      '/projects/old-cloud-title',
      [
        projectFile('main.kcl', 'renamed = 1\n'),
        projectFile(
          PROJECT_SETTINGS_FILE_NAME,
          'title = "New cloud title"\ndefault_file = "main.kcl"\n\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n'
        ),
      ],
      'revision-123'
    )
    const projectToml = new TextDecoder().decode(
      payload.files.find(
        (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
      )?.data
    )

    expect(payload.body.title).toBe('New cloud title')
    expect(projectToml).toContain('title = "New cloud title"')
  })

  it('indexes remote projects that exist in cloud but have no local match', () => {
    expect(
      getCloudSyncRemoteIndexAction({
        hasRemoteProjectId: true,
        isRemoteProjectTombstoned: false,
        hasKnownLocalMetadata: false,
        hasMatchingLocalProject: false,
      })
    ).toBe('index-remote')
  })

  it('skips remote projects that were tombstoned locally', () => {
    expect(
      getCloudSyncRemoteIndexAction({
        hasRemoteProjectId: true,
        isRemoteProjectTombstoned: true,
        hasKnownLocalMetadata: false,
        hasMatchingLocalProject: false,
      })
    ).toBe('skip')
  })

  it('adopts an existing local project when its project.toml matches the cloud id', () => {
    expect(
      getCloudSyncRemoteIndexAction({
        hasRemoteProjectId: true,
        isRemoteProjectTombstoned: false,
        hasKnownLocalMetadata: false,
        hasMatchingLocalProject: true,
      })
    ).toBe('adopt-matching-local')
  })

  it('syncs known cloud-linked projects with unqueued local changes during remote index scans', () => {
    expect(
      getCloudSyncKnownLocalRemoteIndexAction({
        hasPendingLocalChanges: false,
        remoteChanged: false,
        localChangedFromSyncBase: true,
      })
    ).toBe('sync-known-local')

    expect(
      getCloudSyncKnownLocalRemoteIndexAction({
        hasPendingLocalChanges: false,
        remoteChanged: true,
        localChangedFromSyncBase: false,
      })
    ).toBe('sync-known-local')

    expect(
      getCloudSyncKnownLocalRemoteIndexAction({
        hasPendingLocalChanges: true,
        remoteChanged: true,
        localChangedFromSyncBase: true,
      })
    ).toBe('defer-pending-local-changes')

    expect(
      getCloudSyncKnownLocalRemoteIndexAction({
        hasPendingLocalChanges: false,
        remoteChanged: false,
        localChangedFromSyncBase: false,
      })
    ).toBe('index-known-local')
  })

  it('skips sync-excluded conflict copies during the initial local scan', () => {
    expect(
      getCloudSyncInitialLocalProjectSyncAction({
        hasBaseManifest: false,
        tombstone: false,
        syncExcluded: true,
      })
    ).toBe('skip')
  })

  it('still queues unsynced normal projects during the initial local scan', () => {
    expect(
      getCloudSyncInitialLocalProjectSyncAction({
        hasBaseManifest: false,
        tombstone: false,
        syncExcluded: false,
      })
    ).toBe('enqueue')
  })

  it('removes clean local mirrors when their remote project is missing', () => {
    expect(
      getCloudSyncMissingRemoteProjectAction({
        localProjectExists: true,
        hasPendingLocalChanges: false,
        hasBaseManifest: true,
        localMatchesBase: true,
      })
    ).toBe('remove-clean-local')
  })

  it('detaches local projects when their missing remote cannot be safely removed', () => {
    expect(
      getCloudSyncMissingRemoteProjectAction({
        localProjectExists: true,
        hasPendingLocalChanges: true,
        hasBaseManifest: true,
        localMatchesBase: true,
      })
    ).toBe('detach-dirty-local')

    expect(
      getCloudSyncMissingRemoteProjectAction({
        localProjectExists: true,
        hasPendingLocalChanges: false,
        hasBaseManifest: false,
        localMatchesBase: false,
      })
    ).toBe('detach-dirty-local')

    expect(
      getCloudSyncMissingRemoteProjectAction({
        localProjectExists: true,
        hasPendingLocalChanges: false,
        hasBaseManifest: true,
        localMatchesBase: false,
      })
    ).toBe('detach-dirty-local')
  })

  it('forgets metadata when a missing remote project is also missing locally', () => {
    expect(
      getCloudSyncMissingRemoteProjectAction({
        localProjectExists: false,
        hasPendingLocalChanges: false,
        hasBaseManifest: true,
        localMatchesBase: false,
      })
    ).toBe('forget-missing-local')
  })

  it('pushes local edits only when the remote revision is still the synced base', () => {
    expect(
      getCloudSyncProjectSyncPreflightAction({
        latestKind: 'upsert',
        localProjectExists: true,
        tombstone: false,
        hasRemoteProjectId: true,
        localChanged: true,
        remoteChanged: false,
        hasRemoteRevision: true,
      })
    ).toBe('push-local-with-expected-revision')
  })

  it('compares the remote archive before mutating either side when remote is ahead', () => {
    expect(
      getCloudSyncProjectSyncPreflightAction({
        latestKind: 'upsert',
        localProjectExists: true,
        tombstone: false,
        hasRemoteProjectId: true,
        localChanged: true,
        remoteChanged: true,
        hasRemoteRevision: true,
      })
    ).toBe('compare-remote-archive')
  })

  it('hydrates clean local projects from newer remote archives', () => {
    expect(
      getCloudSyncRemoteArchiveReconciliationAction({
        hasBaseManifest: true,
        localMatchesRemote: false,
        localClean: true,
      })
    ).toBe('hydrate-clean-local')
  })

  it('marks a conflict when local and remote archives both changed differently', () => {
    expect(
      getCloudSyncRemoteArchiveReconciliationAction({
        hasBaseManifest: true,
        localMatchesRemote: false,
        localClean: false,
      })
    ).toBe('mark-conflict')
  })

  it('auto-reconciles when local and remote archive changes are independent', () => {
    expect(
      getCloudSyncRemoteArchiveReconciliationAction({
        hasBaseManifest: true,
        localMatchesRemote: false,
        localClean: false,
        canAutoReconcile: true,
      })
    ).toBe('auto-reconcile')
  })

  it('uses remote updated_at for clean cloud projects and local mtime for pending edits', () => {
    const metadata = {
      schemaVersion: 1,
      localProjectPath: '/projects/bracket',
      projectName: 'bracket',
      remoteProjectId: 'project-123',
      remoteUpdatedAt: '2026-06-02T15:00:00.000Z',
      hasPendingChanges: false,
    } as const

    expect(getCloudSyncProjectModifiedTime(metadata, 100)).toBe(
      Date.parse(metadata.remoteUpdatedAt)
    )
    expect(
      getCloudSyncProjectModifiedTime(
        { ...metadata, hasPendingChanges: true },
        100
      )
    ).toBe(100)
  })

  it('plans full cloud sync on Home and scoped sync on file routes', () => {
    const entries: OutboxEntry[] = [
      {
        projectPath: '/projects/current',
        kind: 'upsert',
        targetPath: '/projects/current/main.kcl',
        createdAt: '2026-06-12T00:00:00.000Z',
      },
      {
        projectPath: '/projects/conflicted',
        kind: 'upsert',
        targetPath: '/projects/conflicted/main.kcl',
        createdAt: '2026-06-12T00:00:01.000Z',
      },
    ]

    expect(getCloudSyncScopePlan(entries)).toEqual({
      shouldSyncRemoteIndex: true,
      projectPaths: ['/projects/current', '/projects/conflicted'],
      pendingCount: 2,
    })

    expect(
      getCloudSyncScopePlan(entries, {
        projectPath: '/projects/current',
        libraryPath: '/projects',
        libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
      })
    ).toEqual({
      shouldSyncRemoteIndex: false,
      projectPaths: ['/projects/current'],
      pendingCount: 1,
    })
  })

  it('counts pending cloud sync work by project instead of raw outbox rows', () => {
    const entries: OutboxEntry[] = [
      {
        projectPath: '/projects/current',
        kind: 'upsert',
        targetPath: '/projects/current/main.kcl',
        createdAt: '2026-06-12T00:00:00.000Z',
      },
      {
        projectPath: '/projects/current',
        kind: 'upsert',
        targetPath: '/projects/current/project.toml',
        createdAt: '2026-06-12T00:00:01.000Z',
      },
      {
        projectPath: '/projects/other',
        kind: 'upsert',
        targetPath: '/projects/other/main.kcl',
        createdAt: '2026-06-12T00:00:02.000Z',
      },
    ]

    expect(getCloudSyncScopePlan(entries)).toEqual({
      shouldSyncRemoteIndex: true,
      projectPaths: ['/projects/current', '/projects/other'],
      pendingCount: 2,
    })

    expect(
      getCloudSyncScopePlan(entries, {
        projectPath: '/projects/current',
        libraryPath: '/projects',
        libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
      })
    ).toEqual({
      shouldSyncRemoteIndex: false,
      projectPaths: ['/projects/current'],
      pendingCount: 1,
    })
  })

  it('keeps syncing the open project even when it has no queued local edits', () => {
    expect(
      getCloudSyncScopePlan([], {
        projectPath: '/projects/current',
        libraryPath: '/projects',
        libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
      })
    ).toEqual({
      shouldSyncRemoteIndex: false,
      projectPaths: ['/projects/current'],
      pendingCount: 0,
    })
  })

  it('suppresses sync work for opened projects outside cloud libraries', () => {
    const entries: OutboxEntry[] = [
      {
        projectPath: '/projects/other',
        kind: 'upsert',
        targetPath: '/projects/other/main.kcl',
        createdAt: '2026-06-12T00:00:00.000Z',
      },
    ]

    expect(
      getCloudSyncScopePlan(entries, {
        projectPath: '/external/random',
        libraryPath: '/external',
        libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
      })
    ).toEqual({
      shouldSyncRemoteIndex: false,
      projectPaths: [],
      pendingCount: 0,
    })

    expect(
      getCloudSyncScopePlan(entries, {
        projectPath: '/external/random',
      })
    ).toEqual({
      shouldSyncRemoteIndex: false,
      projectPaths: [],
      pendingCount: 0,
    })
  })

  it('does not auto-enroll unlinked cloud-library projects when cloud-library auto-enrollment is disabled', () => {
    expect(
      shouldAutoEnrollCloudLibraryProject({
        autoEnrollCloudLibraryProjects: false,
        hasRemoteProjectId: false,
        hasBaseManifest: false,
      })
    ).toBe(false)

    expect(
      shouldAutoEnrollCloudLibraryProject({
        autoEnrollCloudLibraryProjects: false,
        hasRemoteProjectId: true,
        hasBaseManifest: false,
      })
    ).toBe(true)

    expect(
      shouldAutoEnrollCloudLibraryProject({
        autoEnrollCloudLibraryProjects: false,
        hasRemoteProjectId: false,
        hasBaseManifest: true,
      })
    ).toBe(true)
  })

  it('backs off sync retries exponentially and respects longer retry-after delays', () => {
    expect(getCloudSyncRetryDelayMs({ attempt: 0 })).toBe(10_000)
    expect(getCloudSyncRetryDelayMs({ attempt: 1 })).toBe(20_000)
    expect(getCloudSyncRetryDelayMs({ attempt: 2 })).toBe(40_000)
    expect(getCloudSyncRetryDelayMs({ attempt: 10 })).toBe(5 * 60 * 1000)
    expect(
      getCloudSyncRetryDelayMs({
        attempt: 0,
        retryAfterMs: 45_000,
      })
    ).toBe(45_000)
  })

  it('throttles full-sync project API requests with bounded jitter', () => {
    expect(
      getCloudSyncProjectApiThrottleDelayMs({
        elapsedMs: 0,
        jitterRatio: 0,
      })
    ).toBe(250)
    expect(
      getCloudSyncProjectApiThrottleDelayMs({
        elapsedMs: 0,
        jitterRatio: 1,
      })
    ).toBe(500)
    expect(
      getCloudSyncProjectApiThrottleDelayMs({
        elapsedMs: 100,
        jitterRatio: 0.5,
      })
    ).toBe(275)
    expect(
      getCloudSyncProjectApiThrottleDelayMs({
        elapsedMs: 500,
        jitterRatio: 0.5,
      })
    ).toBe(0)
    expect(
      getCloudSyncProjectApiThrottleDelayMs({
        elapsedMs: 0,
        jitterRatio: Number.NaN,
      })
    ).toBe(250)
  })

  it('throttles project API requests only for multi-project full syncs', () => {
    expect(
      shouldThrottleCloudSyncProjectApiRequests({
        hasSyncScope: false,
        projectCount: 2,
      })
    ).toBe(true)
    expect(
      shouldThrottleCloudSyncProjectApiRequests({
        hasSyncScope: false,
        projectCount: 1,
      })
    ).toBe(false)
    expect(
      shouldThrottleCloudSyncProjectApiRequests({
        hasSyncScope: true,
        projectCount: 2,
      })
    ).toBe(false)
  })

  it('does not schedule normal pending-work debounce after a retry is scheduled', () => {
    expect(
      shouldScheduleCloudSyncPendingWork({
        pendingCount: 1,
        state: 'failed',
        failureRetryScheduled: true,
      })
    ).toBe(false)

    expect(
      shouldScheduleCloudSyncPendingWork({
        pendingCount: 1,
        state: 'idle',
        failureRetryScheduled: false,
      })
    ).toBe(true)

    expect(
      shouldScheduleCloudSyncPendingWork({
        pendingCount: 1,
        state: 'conflict',
        failureRetryScheduled: false,
      })
    ).toBe(false)
  })
})
