import {
  filterCloudSyncProjectFilesForSync,
  getCloudSyncConflictCopyCleanupPlan,
  getCloudSyncInitialLocalProjectSyncAction,
  getCloudSyncKnownLocalRemoteIndexAction,
  getCloudSyncMissingRemoteProjectAction,
  getCloudSyncProjectModifiedTime,
  getCloudSyncProjectRoot,
  getCloudSyncProjectSyncPreflightAction,
  getCloudSyncRemoteArchiveReconciliationAction,
  getCloudSyncRemoteIndexAction,
  getCloudSyncScopePlan,
  isCloudSyncConflictCopyProjectName,
  type OutboxEntry,
  type ProjectArchiveFile,
  type ProjectManifest,
  prepareProjectFilesForCloudUpload,
  projectManifestsEqual,
  shouldCloudSyncAutoSyncLocalProject,
} from '@src/lib/cloudSync'
import { DEFAULT_CLOUD_PROJECT_DIRECTORY_PATH } from '@src/lib/cloudSync/paths'
import {
  normalizeProjectArchiveFilesForCloudSync,
  projectManifestFromFiles,
  withRemoteProjectMetadataInArchiveFiles,
} from '@src/lib/cloudSync/projectArchive'
import {
  PROJECT_FOLDER,
  PROJECT_IMAGE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import { describe, expect, it } from 'vitest'

const encoder = new TextEncoder()

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
  it('uses a personal Zoo folder as the default cloud project directory fallback', () => {
    expect(DEFAULT_CLOUD_PROJECT_DIRECTORY_PATH).toBe('/documents/Zoo/personal')
  })

  it('identifies project roots beneath the personal Zoo cloud directory', () => {
    expect(
      getCloudSyncProjectRoot(
        '/Users/frank/Library/CloudStorage/Zoo/personal/bracket/main.kcl'
      )
    ).toBe('/Users/frank/Library/CloudStorage/Zoo/personal/bracket')

    expect(
      getCloudSyncProjectRoot('/Users/frank/Library/CloudStorage/Zoo/personal')
    ).toBeUndefined()
  })

  it('identifies project roots beneath the OPFS project directory', () => {
    expect(
      getCloudSyncProjectRoot(`/documents/${PROJECT_FOLDER}/bracket/main.kcl`)
    ).toBe(`/documents/${PROJECT_FOLDER}/bracket`)

    expect(
      getCloudSyncProjectRoot(
        `/documents/${PROJECT_FOLDER}/bracket/nested/part.kcl`
      )
    ).toBe(`/documents/${PROJECT_FOLDER}/bracket`)

    expect(
      getCloudSyncProjectRoot(`/documents/${PROJECT_FOLDER}`)
    ).toBeUndefined()
  })

  it('normalizes Windows separators when identifying project roots', () => {
    expect(
      getCloudSyncProjectRoot(
        `\\documents\\${PROJECT_FOLDER}\\bracket\\main.kcl`
      )
    ).toBe(`/documents/${PROJECT_FOLDER}/bracket`)
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

  it('adds a project.toml upload file when local project settings are missing', () => {
    const payload = prepareProjectFilesForCloudUpload('/projects/bracket', [
      projectFile('main.kcl'),
    ])

    expect(payload.body.entrypoint_path).toBe('main.kcl')
    expect(payload.body.project_toml_path).toBe(PROJECT_SETTINGS_FILE_NAME)
    expect(payload.files.map((file) => file.relativePath)).toEqual([
      'main.kcl',
      PROJECT_SETTINGS_FILE_NAME,
    ])
    expect(
      new TextDecoder().decode(
        payload.files.find(
          (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
        )?.data
      )
    ).toContain('default_file = "main.kcl"')
    expect(
      new TextDecoder().decode(
        payload.files.find(
          (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
        )?.data
      )
    ).toContain('title = "bracket"')
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

  it('normalizes project.toml table order before cloud sync upload and manifest hashing', async () => {
    const localOrderFiles = normalizeProjectArchiveFilesForCloudSync([
      projectFile('main.kcl', 'cube = 1'),
      projectFile(
        PROJECT_SETTINGS_FILE_NAME,
        'title = "demo-project"\ndefault_file = "main.kcl"\n\n[settings.meta]\nid = "settings-id"\n\n[settings.app]\n[settings.modeling]\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n'
      ),
    ])
    const cloudOrderFiles = normalizeProjectArchiveFilesForCloudSync([
      projectFile('main.kcl', 'cube = 1'),
      projectFile(
        PROJECT_SETTINGS_FILE_NAME,
        'default_file = "main.kcl"\ntitle = "demo-project"\n\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n\n[settings.app]\n[settings.meta]\nid = "settings-id"\n\n[settings.modeling]\n'
      ),
    ])
    const uploadPayload = prepareProjectFilesForCloudUpload(
      '/projects/demo-project',
      cloudOrderFiles
    )

    expect(readProjectFile(localOrderFiles, PROJECT_SETTINGS_FILE_NAME)).toBe(
      readProjectFile(cloudOrderFiles, PROJECT_SETTINGS_FILE_NAME)
    )
    expect(
      readProjectFile(uploadPayload.files, PROJECT_SETTINGS_FILE_NAME)
    ).toBe(readProjectFile(localOrderFiles, PROJECT_SETTINGS_FILE_NAME))
    expect(
      projectManifestsEqual(
        await projectManifestFromFiles(localOrderFiles),
        await projectManifestFromFiles(cloudOrderFiles)
      )
    ).toBe(true)
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

  it('detects conflict copy project folder names', () => {
    expect(
      isCloudSyncConflictCopyProjectName(
        'demo-project (cloud conflict 20260612T001401)'
      )
    ).toBe(true)
    expect(
      isCloudSyncConflictCopyProjectName(
        'demo-project (cloud conflict 20260612T001401) (cloud conflict 20260612T124057)'
      )
    ).toBe(true)
    expect(isCloudSyncConflictCopyProjectName('demo-project')).toBe(false)
  })

  it('marks existing conflict copies as excluded and deletes exact duplicate copies', () => {
    const originalManifest: ProjectManifest = {
      files: {
        'main.kcl': { byteSize: 10, sha256: 'a' },
      },
    }
    const changedManifest: ProjectManifest = {
      files: {
        'main.kcl': { byteSize: 11, sha256: 'b' },
      },
    }
    const cleanupPlan = getCloudSyncConflictCopyCleanupPlan([
      {
        projectPath: '/projects/demo-project',
        projectName: 'demo-project',
        remoteProjectId: 'project-123',
        manifest: originalManifest,
      },
      {
        projectPath: '/projects/demo-project (cloud conflict 20260612T001401)',
        projectName: 'demo-project (cloud conflict 20260612T001401)',
        remoteProjectId: 'project-123',
        manifest: originalManifest,
      },
      {
        projectPath:
          '/projects/demo-project (cloud conflict 20260612T001401) (cloud conflict 20260612T124057)',
        projectName:
          'demo-project (cloud conflict 20260612T001401) (cloud conflict 20260612T124057)',
        remoteProjectId: 'project-123',
        manifest: originalManifest,
      },
      {
        projectPath: '/projects/demo-project (cloud conflict 20260612T151955)',
        projectName: 'demo-project (cloud conflict 20260612T151955)',
        remoteProjectId: 'project-123',
        manifest: changedManifest,
      },
    ])

    expect(cleanupPlan.excludeProjectPaths).toEqual([
      '/projects/demo-project (cloud conflict 20260612T001401)',
      '/projects/demo-project (cloud conflict 20260612T001401) (cloud conflict 20260612T124057)',
      '/projects/demo-project (cloud conflict 20260612T151955)',
    ])
    expect(cleanupPlan.deleteProjectPaths).toEqual([
      '/projects/demo-project (cloud conflict 20260612T001401) (cloud conflict 20260612T124057)',
    ])
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

    expect(getCloudSyncScopePlan(entries, '/projects/current')).toEqual({
      shouldSyncRemoteIndex: false,
      projectPaths: ['/projects/current'],
      pendingCount: 1,
    })
  })

  it('keeps syncing the open project even when it has no queued local edits', () => {
    expect(getCloudSyncScopePlan([], '/projects/current')).toEqual({
      shouldSyncRemoteIndex: false,
      projectPaths: ['/projects/current'],
      pendingCount: 0,
    })
  })

  it('does not auto-enroll unlinked local projects when existing local sync is disabled', () => {
    expect(
      shouldCloudSyncAutoSyncLocalProject({
        syncExistingLocalProjects: false,
        hasRemoteProjectId: false,
        hasBaseManifest: false,
      })
    ).toBe(false)

    expect(
      shouldCloudSyncAutoSyncLocalProject({
        syncExistingLocalProjects: false,
        hasRemoteProjectId: true,
        hasBaseManifest: false,
      })
    ).toBe(true)

    expect(
      shouldCloudSyncAutoSyncLocalProject({
        syncExistingLocalProjects: false,
        hasRemoteProjectId: false,
        hasBaseManifest: true,
      })
    ).toBe(true)
  })
})
