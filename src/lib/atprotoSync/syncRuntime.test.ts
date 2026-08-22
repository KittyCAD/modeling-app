import {
  type AtprotoCadSyncClient,
  type AtprotoProjectApiConfig,
  type AtprotoRecordDeleteInput,
  type AtprotoRecordWriteInput,
  createAtprotoRemoteProject,
  getAtprotoRemoteProject,
} from '@src/lib/atprotoSync/api'
import type { AtprotoOAuthConnector } from '@src/lib/atprotoSync/oauth'
import { uploadAtprotoLocalProject } from '@src/lib/atprotoSync/syncRuntime'
import {
  ATPROTO_CAD_ARCHIVE_COLLECTION,
  type AtprotoBlobRef,
  type AtprotoCadArchiveRecord,
  type AtprotoRepoRecord,
} from '@src/lib/atprotoSync/types'
import { parseProjectArchive } from '@src/lib/cloudSync/projectArchive'
import type { ProjectArchiveFile } from '@src/lib/cloudSync/types'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { setAtprotoProjectIdInProjectTomlContents } from '@src/lib/projectTomlMetadata'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
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

  constructor(private readonly cids: string[] = []) {}

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
    const record = {
      uri: recordUri,
      cid: this.cids.shift() ?? `cid-${this.records.size + 1}`,
      value: input.record,
    }
    this.records.set(recordUri, record)
    return record
  }

  async deleteRecord(input: AtprotoRecordDeleteInput) {
    this.records.delete(uri(input.collection, input.rkey))
  }

  async uploadBlob({
    bytes,
    contentType,
  }: {
    repo: string
    bytes: Uint8Array
    contentType: string
  }) {
    const cid = `blob-${this.blobs.size + 1}`
    this.blobs.set(cid, bytes)
    return {
      $type: 'blob',
      ref: { $link: cid },
      mimeType: contentType,
      size: bytes.byteLength,
    } satisfies AtprotoBlobRef
  }

  async getBlob({ blob }: { repo: string; blob: AtprotoBlobRef }) {
    const cid = typeof blob.ref === 'string' ? blob.ref : blob.ref?.$link
    const bytes = cid ? this.blobs.get(cid) : undefined
    if (!bytes) {
      throw new Error('blob not found')
    }
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  }
}

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('ATProto sync runtime', () => {
  it('uploads local materialization edits through the ATProto remote adapter', async () => {
    const testRoot = `/tmp/atproto-sync-runtime-${crypto.randomUUID()}`
    const projectRoot = fsZds.join(testRoot, 'bracket')
    const client = new FakeAtprotoClient([
      'project-initial-cid',
      'archive-cid',
      'project-final-cid',
      'updated-archive-cid',
      'updated-project-cid',
    ])
    const recordKeys = ['project-rkey', 'archive-rkey', 'updated-archive-rkey']
    const config: AtprotoProjectApiConfig = {
      repo,
      client,
      now: () => now,
      createRecordKey: () => recordKeys.shift() ?? 'missing-rkey',
    }
    const remoteProject = await createAtprotoRemoteProject(
      config,
      projectRoot,
      [
        projectFile('main.kcl', 'old = 1'),
        projectFile(PROJECT_SETTINGS_FILE_NAME, 'title = "Bracket"\n'),
      ]
    )
    await fsZds.mkdir(projectRoot, { recursive: true })
    await fsZds.writeFile(
      fsZds.join(projectRoot, 'main.kcl'),
      encoder.encode('new = 2')
    )
    await fsZds.writeFile(
      fsZds.join(projectRoot, PROJECT_SETTINGS_FILE_NAME),
      encoder.encode(
        setAtprotoProjectIdInProjectTomlContents(
          'title = "Bracket"\n',
          remoteProject.id
        )
      )
    )
    const connector: AtprotoOAuthConnector = {
      connect: vi.fn(),
      createProjectApiConfig: vi.fn().mockResolvedValue(config),
    }

    await expect(
      uploadAtprotoLocalProject({
        connector,
        identity: {
          provider: 'atproto',
          did: repo,
          handle: 'franknoirot.co',
          scopes: ['atproto'],
          status: 'connected',
          connectedAt: now,
        },
        projectRoot,
      })
    ).resolves.toBe(true)

    await expect(
      getAtprotoRemoteProject(config, remoteProject.id)
    ).resolves.toMatchObject({
      revision: 'updated-project-cid',
    })
    const [latestArchive] = (
      await client.listRecords<AtprotoCadArchiveRecord>({
        repo,
        collection: ATPROTO_CAD_ARCHIVE_COLLECTION,
      })
    )
      .filter((record) => record.cid === 'updated-archive-cid')
      .map((record) => record.value)
    const uploadedFiles = await parseProjectArchive(
      await client.getBlob({ repo, blob: latestArchive.archiveBlob })
    )
    expect(
      decoder.decode(
        uploadedFiles.find((file) => file.relativePath === 'main.kcl')?.data
      )
    ).toBe('new = 2')
    expect(
      decoder.decode(
        uploadedFiles.find(
          (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
        )?.data
      )
    ).not.toContain('atproto')

    await fsZds.rm(testRoot, { recursive: true, force: true })
  })
})
