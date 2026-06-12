import { PROJECT_FOLDER, PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import {
  type ProjectArchiveFile,
  type ProjectManifest,
  getOpfsCloudConflictFileChanges,
  getOpfsCloudProjectModifiedTime,
  getOpfsCloudProjectRoot,
  getOpfsCloudProjectSyncPreflightAction,
  getOpfsCloudRemoteArchiveReconciliationAction,
  getOpfsCloudRemoteIndexAction,
  prepareProjectFilesForCloudUpload,
  projectManifestsEqual,
} from '@src/lib/fs-zds/opfsCloud'
import { describe, expect, it } from 'vitest'

const encoder = new TextEncoder()

function projectFile(relativePath: string, contents = ''): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

describe('opfsCloud sync helpers', () => {
  it('identifies project roots beneath the OPFS project directory', () => {
    expect(
      getOpfsCloudProjectRoot(`/documents/${PROJECT_FOLDER}/bracket/main.kcl`)
    ).toBe(`/documents/${PROJECT_FOLDER}/bracket`)

    expect(
      getOpfsCloudProjectRoot(
        `/documents/${PROJECT_FOLDER}/bracket/nested/part.kcl`
      )
    ).toBe(`/documents/${PROJECT_FOLDER}/bracket`)

    expect(
      getOpfsCloudProjectRoot(`/documents/${PROJECT_FOLDER}`)
    ).toBeUndefined()
  })

  it('normalizes Windows separators when identifying project roots', () => {
    expect(
      getOpfsCloudProjectRoot(
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
    ).toBe('default_file = "main.kcl"\n')
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

  it('clones remote projects that exist in cloud but have no local match', () => {
    expect(
      getOpfsCloudRemoteIndexAction({
        hasRemoteProjectId: true,
        isRemoteProjectTombstoned: false,
        hasKnownLocalMetadata: false,
        hasMatchingLocalProject: false,
      })
    ).toBe('clone-remote')
  })

  it('skips remote projects that were tombstoned locally', () => {
    expect(
      getOpfsCloudRemoteIndexAction({
        hasRemoteProjectId: true,
        isRemoteProjectTombstoned: true,
        hasKnownLocalMetadata: false,
        hasMatchingLocalProject: false,
      })
    ).toBe('skip')
  })

  it('adopts an existing local project when its project.toml matches the cloud id', () => {
    expect(
      getOpfsCloudRemoteIndexAction({
        hasRemoteProjectId: true,
        isRemoteProjectTombstoned: false,
        hasKnownLocalMetadata: false,
        hasMatchingLocalProject: true,
      })
    ).toBe('adopt-matching-local')
  })

  it('pushes local edits only when the remote revision is still the synced base', () => {
    expect(
      getOpfsCloudProjectSyncPreflightAction({
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
      getOpfsCloudProjectSyncPreflightAction({
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
      getOpfsCloudRemoteArchiveReconciliationAction({
        hasBaseManifest: true,
        localMatchesRemote: false,
        localClean: true,
      })
    ).toBe('hydrate-clean-local')
  })

  it('marks a conflict when local and remote archives both changed differently', () => {
    expect(
      getOpfsCloudRemoteArchiveReconciliationAction({
        hasBaseManifest: true,
        localMatchesRemote: false,
        localClean: false,
      })
    ).toBe('mark-conflict')
  })

  it('classifies project conflict paths against the last synced base', () => {
    const baseManifest: ProjectManifest = {
      files: {
        'remote-safe.kcl': { byteSize: 1, sha256: 'base' },
        'local-only.kcl': { byteSize: 1, sha256: 'base' },
        'same.kcl': { byteSize: 1, sha256: 'base' },
        'different.kcl': { byteSize: 1, sha256: 'base' },
        'delete-conflict.kcl': { byteSize: 1, sha256: 'base' },
        'binary.bin': { byteSize: 1, sha256: 'base' },
      },
    }
    const localManifest: ProjectManifest = {
      files: {
        'remote-safe.kcl': { byteSize: 1, sha256: 'base' },
        'local-only.kcl': { byteSize: 2, sha256: 'local' },
        'same.kcl': { byteSize: 2, sha256: 'same' },
        'different.kcl': { byteSize: 2, sha256: 'local' },
        'binary.bin': { byteSize: 2, sha256: 'local' },
      },
    }
    const remoteManifest: ProjectManifest = {
      files: {
        'remote-safe.kcl': { byteSize: 2, sha256: 'remote' },
        'local-only.kcl': { byteSize: 1, sha256: 'base' },
        'same.kcl': { byteSize: 2, sha256: 'same' },
        'different.kcl': { byteSize: 2, sha256: 'remote' },
        'delete-conflict.kcl': { byteSize: 2, sha256: 'remote' },
        'binary.bin': { byteSize: 2, sha256: 'remote' },
      },
    }

    expect(
      getOpfsCloudConflictFileChanges({
        baseManifest,
        localManifest,
        remoteManifest,
        localFiles: [
          projectFile('different.kcl', 'local = 1'),
          projectFile('binary.bin', '\u0000local'),
        ],
        remoteFiles: [
          projectFile('different.kcl', 'remote = 1'),
          projectFile('binary.bin', '\u0000remote'),
        ],
      }).map(({ relativePath, status }) => [relativePath, status])
    ).toEqual([
      ['binary.bin', 'binary-conflict'],
      ['delete-conflict.kcl', 'add-delete-conflict'],
      ['different.kcl', 'both-changed-differently'],
      ['local-only.kcl', 'local-changed'],
      ['remote-safe.kcl', 'remote-changed'],
      ['same.kcl', 'both-changed-identically'],
    ])
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

    expect(getOpfsCloudProjectModifiedTime(metadata, 100)).toBe(
      Date.parse(metadata.remoteUpdatedAt)
    )
    expect(
      getOpfsCloudProjectModifiedTime(
        { ...metadata, hasPendingChanges: true },
        100
      )
    ).toBe(100)
  })
})
