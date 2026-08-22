import { parseProjectArchive } from '@src/lib/cloudSync/projectArchive'
import type { ProjectArchiveFile } from '@src/lib/cloudSync/types'
import {
  AtprotoSyncStaleRevisionError,
  type AtprotoCadSyncClient,
  type AtprotoRecordDeleteInput,
  type AtprotoRecordWriteInput,
  createAtprotoRemoteProject,
  deleteAtprotoRemoteProject,
  downloadAtprotoRemoteProjectArchive,
  getAtprotoRemoteProject,
  listAtprotoRemoteProjects,
  parseAtprotoUri,
  updateAtprotoRemoteProject,
} from '@src/lib/atprotoSync/api'
import {
  ATPROTO_CAD_ARCHIVE_COLLECTION,
  ATPROTO_CAD_PROJECT_COLLECTION,
  type AtprotoBlobRef,
  type AtprotoCadArchiveRecord,
  type AtprotoCadProjectRecord,
  type AtprotoRepoRecord,
} from '@src/lib/atprotoSync/types'
import { describe, expect, test, vi } from 'vitest'

const encoder = new TextEncoder()
const repo = 'did:plc:frank'
const now = '2026-08-22T12:00:00.000Z'

function projectFile(
  relativePath: string,
  contents: string
): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

function uri(collection: string, rkey: string) {
  return `at://${repo}/${collection}/${rkey}`
}

class FakeAtprotoClient implements AtprotoCadSyncClient {
  records = new Map<string, AtprotoRepoRecord<unknown>>()
  blobs = new Map<string, Uint8Array>()
  putRecordCalls: AtprotoRecordWriteInput<unknown>[] = []
  deleteRecordCalls: AtprotoRecordDeleteInput[] = []
  uploadBlob = vi.fn<AtprotoCadSyncClient['uploadBlob']>(
    async ({ bytes, contentType }) => {
      const cid = `blob-${this.blobs.size + 1}`
      this.blobs.set(cid, bytes)
      return {
        $type: 'blob',
        ref: { $link: cid },
        mimeType: contentType,
        size: bytes.byteLength,
      }
    }
  )

  constructor(private readonly cids: string[] = []) {}

  seed<Value>(collection: string, rkey: string, cid: string, value: Value) {
    const record = {
      uri: uri(collection, rkey),
      cid,
      value,
    }
    this.records.set(record.uri, record)
    return record
  }

  async listRecords<Value>({
    repo: requestedRepo,
    collection,
  }: {
    repo: string
    collection: string
  }) {
    const prefix = `at://${requestedRepo}/${collection}/`
    return Array.from(this.records.values()).filter((record) =>
      record.uri.startsWith(prefix)
    ) as AtprotoRepoRecord<Value>[]
  }

  async getRecord<Value>({
    repo: requestedRepo,
    collection,
    rkey,
  }: {
    repo: string
    collection: string
    rkey: string
  }) {
    const record = this.records.get(
      `at://${requestedRepo}/${collection}/${rkey}`
    )
    if (!record) {
      throw new Error('record not found')
    }
    return record as AtprotoRepoRecord<Value>
  }

  async putRecord<Value>(input: AtprotoRecordWriteInput<Value>) {
    this.putRecordCalls.push(input as AtprotoRecordWriteInput<unknown>)
    const recordUri = uri(input.collection, input.rkey)
    const existing = this.records.get(recordUri)
    if (input.swapRecord === null && existing) {
      throw new Error('record already exists')
    }
    if (
      typeof input.swapRecord === 'string' &&
      existing?.cid !== input.swapRecord
    ) {
      throw new AtprotoSyncStaleRevisionError({
        expectedRevision: input.swapRecord,
        currentRevision: existing?.cid,
      })
    }

    const record = {
      uri: recordUri,
      cid: this.cids.shift() ?? `cid-${this.records.size + 1}`,
      value: input.record,
    }
    this.records.set(recordUri, record)
    return record
  }

  async deleteRecord(input: AtprotoRecordDeleteInput) {
    this.deleteRecordCalls.push(input)
    this.records.delete(uri(input.collection, input.rkey))
  }

  async getBlob({
    blob,
  }: {
    repo: string
    blob: AtprotoBlobRef
  }): Promise<ArrayBuffer> {
    const cid =
      typeof blob.ref === 'string'
        ? blob.ref
        : typeof blob.ref?.$link === 'string'
          ? blob.ref.$link
          : undefined
    const bytes = cid ? this.blobs.get(cid) : undefined
    if (!bytes) {
      throw new Error('blob not found')
    }
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer as ArrayBuffer
  }
}

function projectRecord(
  value: Partial<AtprotoCadProjectRecord> = {}
): AtprotoCadProjectRecord {
  return {
    title: 'Bracket',
    description: 'Existing description',
    categoryIds: ['existing-category'],
    createdAt: now,
    updatedAt: now,
    syncUpdatedAt: now,
    ...value,
  }
}

function archiveRecord(
  project: AtprotoRepoRecord<AtprotoCadProjectRecord>,
  blob: AtprotoBlobRef
): AtprotoCadArchiveRecord {
  return {
    project: {
      uri: project.uri,
      cid: project.cid,
    },
    archiveBlob: blob,
    archiveSha256:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    archiveByteSize: 10,
    entrypointPath: 'main.kcl',
    projectTomlPath: 'project.toml',
    createdAt: now,
  }
}

describe('ATProto project API adapter', () => {
  test('lists only sync-capable project records', async () => {
    const client = new FakeAtprotoClient()
    const syncProject = client.seed(
      ATPROTO_CAD_PROJECT_COLLECTION,
      'sync-project',
      'project-cid',
      projectRecord({
        headArchive: {
          uri: uri(ATPROTO_CAD_ARCHIVE_COLLECTION, 'archive'),
          cid: 'archive-cid',
        },
      })
    )
    client.seed(
      ATPROTO_CAD_PROJECT_COLLECTION,
      'catalog-project',
      'catalog-cid',
      projectRecord()
    )

    await expect(listAtprotoRemoteProjects({ repo, client })).resolves.toEqual([
      expect.objectContaining({
        id: syncProject.uri,
        revision: syncProject.cid,
      }),
    ])
  })

  test('creates project and archive records with a guarded head update', async () => {
    const client = new FakeAtprotoClient([
      'project-initial-cid',
      'archive-cid',
      'project-final-cid',
    ])
    const recordKeys = ['project-rkey', 'archive-rkey']

    const remoteProject = await createAtprotoRemoteProject(
      {
        repo,
        client,
        now: () => now,
        createRecordKey: () => recordKeys.shift() ?? 'missing-rkey',
        source: 'zds-test',
      },
      '/projects/bracket',
      [projectFile('main.kcl', 'line([0, 0], [1, 1])')]
    )

    expect(remoteProject).toMatchObject({
      id: uri(ATPROTO_CAD_PROJECT_COLLECTION, 'project-rkey'),
      revision: 'project-final-cid',
      title: 'bracket',
      description: '',
      category_ids: [],
    })
    expect(client.putRecordCalls).toMatchObject([
      {
        collection: ATPROTO_CAD_PROJECT_COLLECTION,
        rkey: 'project-rkey',
        swapRecord: null,
      },
      {
        collection: ATPROTO_CAD_ARCHIVE_COLLECTION,
        rkey: 'archive-rkey',
        swapRecord: null,
      },
      {
        collection: ATPROTO_CAD_PROJECT_COLLECTION,
        rkey: 'project-rkey',
        swapRecord: 'project-initial-cid',
      },
    ])

    const archive = await client.getRecord<AtprotoCadArchiveRecord>({
      repo,
      collection: ATPROTO_CAD_ARCHIVE_COLLECTION,
      rkey: 'archive-rkey',
    })
    expect(archive.value.project).toEqual({
      uri: uri(ATPROTO_CAD_PROJECT_COLLECTION, 'project-rkey'),
      cid: 'project-initial-cid',
    })
    expect(archive.value.source).toBe('zds-test')

    const archiveBytes = await downloadAtprotoRemoteProjectArchive(
      { repo, client },
      remoteProject.id
    )
    const files = await parseProjectArchive(archiveBytes)
    expect(files.map((file) => file.relativePath).toSorted()).toEqual([
      'main.kcl',
      'project.toml',
    ])
  })

  test('updates projects with expected_revision as the project record CID', async () => {
    const client = new FakeAtprotoClient(['archive-cid', 'project-updated-cid'])
    const project = client.seed(
      ATPROTO_CAD_PROJECT_COLLECTION,
      'project-rkey',
      'project-current-cid',
      projectRecord({
        headArchive: {
          uri: uri(ATPROTO_CAD_ARCHIVE_COLLECTION, 'old-archive'),
          cid: 'old-archive-cid',
        },
      })
    )
    client.blobs.set('old-blob', encoder.encode('old archive bytes'))
    client.seed(
      ATPROTO_CAD_ARCHIVE_COLLECTION,
      'old-archive',
      'old-archive-cid',
      archiveRecord(project, {
        ref: { $link: 'old-blob' },
        mimeType: 'application/zip',
      })
    )

    const remoteProject = await updateAtprotoRemoteProject({
      config: {
        repo,
        client,
        now: () => now,
        createRecordKey: () => 'new-archive',
      },
      projectPath: '/projects/bracket',
      project: {
        id: project.uri,
        title: 'Bracket',
        description: 'Existing description',
        category_ids: ['existing-category'],
        revision: project.cid,
      },
      files: [projectFile('main.kcl', 'line([0, 0], [2, 2])')],
      expectedRevision: project.cid,
    })

    expect(remoteProject.revision).toBe('project-updated-cid')
    expect(client.putRecordCalls.at(-1)).toMatchObject({
      collection: ATPROTO_CAD_PROJECT_COLLECTION,
      rkey: 'project-rkey',
      swapRecord: 'project-current-cid',
      record: {
        title: 'bracket',
        description: 'Existing description',
        categoryIds: ['existing-category'],
        headArchive: {
          uri: uri(ATPROTO_CAD_ARCHIVE_COLLECTION, 'new-archive'),
          cid: 'archive-cid',
        },
      },
    })
  })

  test('rejects stale expected revisions before uploading a new archive blob', async () => {
    const client = new FakeAtprotoClient()
    const project = client.seed(
      ATPROTO_CAD_PROJECT_COLLECTION,
      'project-rkey',
      'project-current-cid',
      projectRecord({
        headArchive: {
          uri: uri(ATPROTO_CAD_ARCHIVE_COLLECTION, 'old-archive'),
          cid: 'old-archive-cid',
        },
      })
    )

    await expect(
      updateAtprotoRemoteProject({
        config: {
          repo,
          client,
          now: () => now,
          createRecordKey: () => 'new-archive',
        },
        projectPath: '/projects/bracket',
        project: {
          id: project.uri,
          title: 'Bracket',
          description: '',
          category_ids: [],
          revision: project.cid,
        },
        files: [projectFile('main.kcl', 'line([0, 0], [2, 2])')],
        expectedRevision: 'stale-cid',
      })
    ).rejects.toBeInstanceOf(AtprotoSyncStaleRevisionError)

    expect(client.uploadBlob).not.toHaveBeenCalled()
  })

  test('gets and deletes projects by AT URI', async () => {
    const client = new FakeAtprotoClient()
    const project = client.seed(
      ATPROTO_CAD_PROJECT_COLLECTION,
      'project-rkey',
      'project-current-cid',
      projectRecord({
        headArchive: {
          uri: uri(ATPROTO_CAD_ARCHIVE_COLLECTION, 'archive-rkey'),
          cid: 'archive-cid',
        },
      })
    )

    await expect(
      getAtprotoRemoteProject({ repo, client }, project.uri)
    ).resolves.toMatchObject({
      id: project.uri,
      revision: project.cid,
    })
    await deleteAtprotoRemoteProject({ repo, client }, project.uri)

    expect(client.deleteRecordCalls).toEqual([parseAtprotoUri(project.uri)])
  })
})
