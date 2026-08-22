import type { ProjectManifest } from '@src/lib/cloudSync/types'
import {
  atprotoArchiveManifestToProjectManifest,
  atprotoArchiveRecordFromUploadBody,
  atprotoProjectRecordToRemoteProject,
  projectManifestToAtprotoArchiveManifest,
  projectRecordFromUploadBody,
  projectUploadBodyFromAtprotoRecords,
} from '@src/lib/atprotoSync/mapping'
import {
  ATPROTO_CAD_ARCHIVE_COLLECTION,
  ATPROTO_CAD_PROJECT_COLLECTION,
  type AtprotoBlobRef,
  type AtprotoCadArchiveRecord,
  type AtprotoCadProjectRecord,
  type AtprotoRepoRecord,
  type AtprotoStrongRef,
} from '@src/lib/atprotoSync/types'
import { describe, expect, test } from 'vitest'

const projectUri = 'at://did:plc:frank/nyc.noirot.cad.project/3l7a4cbr4ws2b'
const projectCid = 'bafyreiprojectcid'
const archiveUri = 'at://did:plc:frank/nyc.noirot.cad.archive/3l7a4cc3a4c2b'
const archiveCid = 'bafyreiarcivecid'

const archiveRef: AtprotoStrongRef = {
  uri: archiveUri,
  cid: archiveCid,
}

const blobRef: AtprotoBlobRef = {
  $type: 'blob',
  ref: {
    $link: 'bafkreizipblob',
  },
  mimeType: 'application/zip',
  size: 21,
}

function projectRecord(
  value: AtprotoCadProjectRecord
): AtprotoRepoRecord<AtprotoCadProjectRecord> {
  return {
    uri: projectUri,
    cid: projectCid,
    value,
  }
}

describe('ATProto CAD project mapping', () => {
  test('maps sync-capable project records to current remote project summaries', () => {
    const remoteProject = atprotoProjectRecordToRemoteProject(
      projectRecord({
        title: 'Bracket',
        description: 'A syncable bracket',
        categoryIds: ['fixtures', 'cad'],
        createdAt: '2026-08-22T12:00:00.000Z',
        updatedAt: '2026-08-22T12:01:00.000Z',
        syncUpdatedAt: '2026-08-22T12:02:00.000Z',
        headArchive: archiveRef,
      })
    )

    expect(remoteProject).toEqual({
      id: projectUri,
      title: 'Bracket',
      description: 'A syncable bracket',
      category_ids: ['fixtures', 'cad'],
      updated_at: '2026-08-22T12:02:00.000Z',
      revision: projectCid,
      atproto: {
        project: {
          uri: projectUri,
          cid: projectCid,
        },
        headArchive: archiveRef,
      },
    })
  })

  test('uses legacy project name fields as remote project titles', () => {
    const remoteProject = atprotoProjectRecordToRemoteProject(
      projectRecord({
        title: '',
        name: 'Legacy Bracket',
        createdAt: '2026-08-22T12:00:00.000Z',
        headArchive: archiveRef,
      })
    )

    expect(remoteProject?.title).toBe('Legacy Bracket')
  })

  test('does not treat catalog-only project records as sync-capable', () => {
    expect(
      atprotoProjectRecordToRemoteProject(
        projectRecord({
          title: 'Catalog Only',
          createdAt: '2026-08-22T12:00:00.000Z',
        })
      )
    ).toBeUndefined()
  })

  test('round-trips upload metadata through project and archive records', () => {
    const body = {
      title: 'Bracket',
      description: 'A syncable bracket',
      category_ids: ['fixtures', 'cad'],
      entrypoint_path: 'main.kcl',
      project_toml_path: 'project.toml',
    }
    const now = '2026-08-22T12:00:00.000Z'
    const project = projectRecordFromUploadBody(body, now, archiveRef)
    const archive: AtprotoCadArchiveRecord = {
      project: {
        uri: projectUri,
        cid: projectCid,
      },
      archiveBlob: blobRef,
      archiveSha256:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      archiveByteSize: 21,
      entrypointPath: 'main.kcl',
      projectTomlPath: 'project.toml',
      createdAt: now,
    }

    expect(project).toEqual({
      $type: ATPROTO_CAD_PROJECT_COLLECTION,
      title: 'Bracket',
      description: 'A syncable bracket',
      categoryIds: ['fixtures', 'cad'],
      createdAt: now,
      updatedAt: now,
      syncUpdatedAt: now,
      headArchive: archiveRef,
    })
    expect(projectUploadBodyFromAtprotoRecords(project, archive)).toEqual(body)
    expect(
      projectUploadBodyFromAtprotoRecords(project, archive, 'rev-1')
    ).toEqual({
      ...body,
      expected_revision: 'rev-1',
    })
  })
})

describe('ATProto CAD archive mapping', () => {
  test('converts project manifests between ZDS map and lexicon array forms', () => {
    const manifest: ProjectManifest = {
      files: {
        'project.toml': {
          byteSize: 14,
          sha256:
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        'nested/main.kcl': {
          byteSize: 21,
          sha256:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    }

    const atprotoManifest = projectManifestToAtprotoArchiveManifest(manifest)

    expect(atprotoManifest).toEqual({
      files: [
        {
          path: 'nested/main.kcl',
          byteSize: 21,
          sha256:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        {
          path: 'project.toml',
          byteSize: 14,
          sha256:
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
    })
    expect(atprotoArchiveManifestToProjectManifest(atprotoManifest)).toEqual(
      manifest
    )
  })

  test('builds archive records from upload metadata and archive bytes', async () => {
    const manifest: ProjectManifest = {
      files: {
        'main.kcl': {
          byteSize: 12,
          sha256:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    }
    const archive = await atprotoArchiveRecordFromUploadBody({
      project: {
        uri: projectUri,
        cid: projectCid,
      },
      body: {
        title: 'Bracket',
        description: '',
        category_ids: [],
        entrypoint_path: './main.kcl',
        project_toml_path: '/project.toml',
      },
      archiveBlob: blobRef,
      archiveBytes: new TextEncoder().encode('zip bytes'),
      manifest,
      createdAt: '2026-08-22T12:00:00.000Z',
      source: 'zds-test',
    })

    expect(archive).toMatchObject({
      $type: ATPROTO_CAD_ARCHIVE_COLLECTION,
      project: {
        uri: projectUri,
        cid: projectCid,
      },
      archiveBlob: blobRef,
      archiveByteSize: 9,
      entrypointPath: 'main.kcl',
      projectTomlPath: 'project.toml',
      createdAt: '2026-08-22T12:00:00.000Z',
      zdsSchemaVersion: 1,
      source: 'zds-test',
      manifest: {
        files: [
          {
            path: 'main.kcl',
            byteSize: 12,
            sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        ],
      },
    })
    expect(archive.archiveSha256).toMatch(/^[a-f0-9]{64}$/)
  })
})
