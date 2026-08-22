import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  ATPROTO_ARCHIVE_BLOB_SCOPE,
  ATPROTO_AUTH_SYNC_SCOPE,
  ATPROTO_PROJECT_LIBRARY_TYPE,
  type AtprotoOAuthConnector,
  type AtprotoOAuthIdentity,
} from '@src/lib/atprotoSync'
import {
  type AtprotoCadSyncClient,
  type AtprotoRecordDeleteInput,
  type AtprotoRecordWriteInput,
  createAtprotoRemoteProject,
  getAtprotoRemoteProject,
} from '@src/lib/atprotoSync/api'
import { readAtprotoSyncLocalMetadata } from '@src/lib/atprotoSync/localSync'
import { createAtprotoProjectLibraryType } from '@src/lib/atprotoSync/projectLibrary'
import {
  ATPROTO_CAD_PROJECT_COLLECTION,
  type AtprotoBlobRef,
  type AtprotoRepoRecord,
} from '@src/lib/atprotoSync/types'
import { parseProjectArchive } from '@src/lib/cloudSync/projectArchive'
import type { ProjectArchiveFile } from '@src/lib/cloudSync/types'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  getAtprotoProjectIdFromProjectTomlContents,
  setAtprotoProjectIdInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { homeProjectEntriesValueSpec } from '@src/registry/contracts/homeProjects'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

const encoder = new TextEncoder()
const repo = 'did:plc:frank'
const now = '2026-08-22T12:00:00.000Z'
const fakeWasm = {
  default_app_settings: () => ({
    settings: {
      app: {
        show_all_files: false,
      },
      modeling: {
        base_unit: 'mm',
      },
    },
  }),
  parse_app_settings: () => ({
    settings: {
      app: {
        show_all_files: false,
      },
      modeling: {
        base_unit: 'mm',
      },
    },
  }),
  default_project_settings: () => ({}),
  parse_project_settings: () => ({}),
  relevant_file_extensions: () => ['kcl'],
} as unknown as ModuleType

const identity: AtprotoOAuthIdentity = {
  provider: 'atproto',
  did: repo,
  handle: 'franknoirot.co',
  serviceUrl: 'https://pds.example',
  scopes: ['atproto', ATPROTO_AUTH_SYNC_SCOPE, ATPROTO_ARCHIVE_BLOB_SCOPE],
  status: 'connected',
  connectedAt: now,
}

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
    this.deleteRecordCalls.push(input)
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
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  }
}

function createFakeSettingsService(library: ProjectLibrary) {
  const current = signal({
    app: {
      libraries: {
        current: [library],
      },
    },
    auth: {
      atproto: {
        current: identity,
      },
    },
  })

  return {
    actor: {} as SettingsRegistryService['actor'],
    current,
    get: () => current.value,
    send: vi.fn() as SettingsRegistryService['send'],
    useSettings: () => current.value,
  } as unknown as SettingsRegistryService
}

async function createRemoteProject(client: FakeAtprotoClient) {
  const recordKeys = ['project-rkey', 'archive-rkey']
  return createAtprotoRemoteProject(
    {
      repo,
      client,
      now: () => now,
      createRecordKey: () => recordKeys.shift() ?? 'missing-rkey',
    },
    '/projects/bracket',
    [
      projectFile('main.kcl', 'line([0, 0], [1, 1])'),
      projectFile('project.toml', 'title = "Bracket"\n'),
    ]
  )
}

function createRegistry({
  library,
  connector,
}: {
  library: ProjectLibrary
  connector: AtprotoOAuthConnector
}) {
  const registry = new Registry()
  registry.configure([
    defineRegistryItem({
      id: 'test-settings',
      providesServices: [
        provideService(settingsService, createFakeSettingsService(library)),
      ],
      provides: [provideWasmPromise(Promise.resolve(fakeWasm))],
    }),
    createAtprotoProjectLibraryType({ connector }),
  ])
  return registry
}

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('ATProto project library type', () => {
  it('lists remote projects and materializes them locally on open', async () => {
    const testRoot = `/tmp/atproto-project-library-${crypto.randomUUID()}`
    const library = {
      id: 'atproto-test',
      title: 'ATProto',
      path: fsZds.join(testRoot, 'library'),
      type: ATPROTO_PROJECT_LIBRARY_TYPE,
      source: 'franknoirot.co',
    } satisfies ProjectLibrary
    const client = new FakeAtprotoClient([
      'project-initial-cid',
      'archive-cid',
      'project-final-cid',
    ])
    const remoteProject = await createRemoteProject(client)
    const connector: AtprotoOAuthConnector = {
      connect: vi.fn(),
      createProjectApiConfig: vi.fn().mockResolvedValue({ repo, client }),
    }
    const registry = createRegistry({ library, connector })

    try {
      const libraryType = registry
        .get(projectLibraryTypesValueSpec)
        .get(ATPROTO_PROJECT_LIBRARY_TYPE)
      expect(libraryType?.operations?.openProject).toBeDefined()

      await vi.waitFor(() =>
        expect(registry.get(homeProjectEntriesValueSpec)).toEqual([
          expect.objectContaining({
            source: 'remote',
            status: 'cloud-only',
            remoteProjectId: remoteProject.id,
            title: 'Bracket',
          }),
        ])
      )

      const opened = await libraryType?.operations?.openProject?.run({
        library,
        project: {
          id: `remote:${remoteProject.id}`,
          source: 'remote',
          status: 'cloud-only',
          libraryIds: [library.id],
          name: 'Bracket',
          title: 'Bracket',
          remoteProjectId: remoteProject.id,
          readWriteAccess: true,
        },
      })

      expect(opened?.defaultFile).toBe(
        fsZds.join(library.path, 'bracket', 'main.kcl')
      )
      const projectToml = await fsZds.readFile(
        fsZds.join(library.path, 'bracket', PROJECT_SETTINGS_FILE_NAME),
        { encoding: 'utf-8' }
      )
      expect(getAtprotoProjectIdFromProjectTomlContents(projectToml)).toBe(
        remoteProject.id
      )
      await expect(
        readAtprotoSyncLocalMetadata(fsZds.join(library.path, 'bracket'))
      ).resolves.toMatchObject({
        remoteProjectId: remoteProject.id,
        remoteRevision: remoteProject.revision,
        baseManifest: expect.objectContaining({
          files: expect.objectContaining({
            'main.kcl': expect.any(Object),
          }),
        }),
      })
    } finally {
      registry[Symbol.dispose]()
      await fsZds.rm(testRoot, { recursive: true, force: true })
    }
  })

  it('creates local projects, publishes them remotely, and removes local ATProto metadata from uploaded archives', async () => {
    const testRoot = `/tmp/atproto-project-create-${crypto.randomUUID()}`
    const library = {
      id: 'atproto-test',
      title: 'ATProto',
      path: fsZds.join(testRoot, 'library'),
      type: ATPROTO_PROJECT_LIBRARY_TYPE,
      source: 'franknoirot.co',
    } satisfies ProjectLibrary
    const client = new FakeAtprotoClient([
      'project-initial-cid',
      'archive-cid',
      'project-final-cid',
    ])
    const recordKeys = ['project-rkey', 'archive-rkey']
    const connector: AtprotoOAuthConnector = {
      connect: vi.fn(),
      createProjectApiConfig: vi.fn().mockResolvedValue({
        repo,
        client,
        createRecordKey: () => recordKeys.shift() ?? 'missing-rkey',
      }),
    }
    const registry = createRegistry({ library, connector })

    try {
      const libraryType = registry
        .get(projectLibraryTypesValueSpec)
        .get(ATPROTO_PROJECT_LIBRARY_TYPE)
      const project = await libraryType?.operations?.createProject?.run({
        library,
        requestedProjectName: 'bracket',
        requestedProjectTitle: 'Bracket',
        initialProject: {
          entrypointFilePath: 'main.kcl',
          files: [
            {
              requestedFileName: 'main.kcl',
              requestedData: encoder.encode('line([0, 0], [1, 1])'),
            },
            {
              requestedFileName: PROJECT_SETTINGS_FILE_NAME,
              requestedData: encoder.encode('title = "Bracket"\n'),
            },
          ],
        },
      })

      expect(project?.path).toBe(fsZds.join(library.path, 'bracket'))
      const remoteProject = (
        await client.listRecords({
          repo,
          collection: ATPROTO_CAD_PROJECT_COLLECTION,
        })
      )[0]
      expect(remoteProject).toMatchObject({
        uri: 'at://did:plc:frank/nyc.noirot.cad.project/project-rkey',
        cid: 'project-final-cid',
      })
      const projectToml = await fsZds.readFile(
        fsZds.join(library.path, 'bracket', PROJECT_SETTINGS_FILE_NAME),
        { encoding: 'utf-8' }
      )
      expect(getAtprotoProjectIdFromProjectTomlContents(projectToml)).toBe(
        remoteProject.uri
      )
      await expect(
        readAtprotoSyncLocalMetadata(fsZds.join(library.path, 'bracket'))
      ).resolves.toMatchObject({
        remoteProjectId: remoteProject.uri,
        remoteRevision: 'project-final-cid',
        baseManifest: expect.objectContaining({
          files: expect.objectContaining({
            'main.kcl': expect.any(Object),
          }),
        }),
      })

      const archiveRecord = (
        await client.listRecords({
          repo,
          collection: 'nyc.noirot.cad.archive',
        })
      )[0] as AtprotoRepoRecord<{ archiveBlob: AtprotoBlobRef }>
      const archiveFiles = await parseProjectArchive(
        await client.getBlob({ repo, blob: archiveRecord.value.archiveBlob })
      )
      const uploadedProjectToml = new TextDecoder().decode(
        archiveFiles.find(
          (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
        )?.data
      )
      expect(
        getAtprotoProjectIdFromProjectTomlContents(uploadedProjectToml)
      ).toBeUndefined()
    } finally {
      registry[Symbol.dispose]()
      await fsZds.rm(testRoot, { recursive: true, force: true })
    }
  })

  it('renames and deletes remote-only projects through the ATProto adapter', async () => {
    const testRoot = `/tmp/atproto-project-remote-ops-${crypto.randomUUID()}`
    const library = {
      id: 'atproto-test',
      title: 'ATProto',
      path: fsZds.join(testRoot, 'library'),
      type: ATPROTO_PROJECT_LIBRARY_TYPE,
      source: 'franknoirot.co',
    } satisfies ProjectLibrary
    const client = new FakeAtprotoClient([
      'project-initial-cid',
      'archive-cid',
      'project-final-cid',
      'renamed-archive-cid',
      'renamed-project-cid',
    ])
    const remoteProject = await createRemoteProject(client)
    const connector: AtprotoOAuthConnector = {
      connect: vi.fn(),
      createProjectApiConfig: vi.fn().mockResolvedValue({ repo, client }),
    }
    const registry = createRegistry({ library, connector })

    try {
      const libraryType = registry
        .get(projectLibraryTypesValueSpec)
        .get(ATPROTO_PROJECT_LIBRARY_TYPE)
      const project = {
        id: `remote:${remoteProject.id}`,
        source: 'remote' as const,
        status: 'cloud-only' as const,
        libraryIds: [library.id],
        name: 'Bracket',
        title: 'Bracket',
        remoteProjectId: remoteProject.id,
        readWriteAccess: true,
      }

      await libraryType?.operations?.renameProject?.run({
        library,
        project,
        requestedName: 'Renamed Bracket',
      })

      await expect(
        getAtprotoRemoteProject({ repo, client }, remoteProject.id)
      ).resolves.toMatchObject({
        title: 'Renamed Bracket',
        revision: 'renamed-project-cid',
      })

      await libraryType?.operations?.deleteProject?.run({ library, project })

      expect(client.deleteRecordCalls).toEqual([
        {
          repo,
          collection: ATPROTO_CAD_PROJECT_COLLECTION,
          rkey: 'project-rkey',
        },
      ])
    } finally {
      registry[Symbol.dispose]()
      await fsZds.rm(testRoot, { recursive: true, force: true })
    }
  })

  it('recognizes existing local materializations by their ATProto project marker', async () => {
    const testRoot = `/tmp/atproto-project-local-${crypto.randomUUID()}`
    const library = {
      id: 'atproto-test',
      title: 'ATProto',
      path: fsZds.join(testRoot, 'library'),
      type: ATPROTO_PROJECT_LIBRARY_TYPE,
      source: 'franknoirot.co',
    } satisfies ProjectLibrary
    const client = new FakeAtprotoClient([
      'project-initial-cid',
      'archive-cid',
      'project-final-cid',
    ])
    const remoteProject = await createRemoteProject(client)
    await fsZds.mkdir(fsZds.join(library.path, 'bracket'), { recursive: true })
    await fsZds.writeFile(
      fsZds.join(library.path, 'bracket', 'main.kcl'),
      encoder.encode('line([0, 0], [1, 1])')
    )
    await fsZds.writeFile(
      fsZds.join(library.path, 'bracket', PROJECT_SETTINGS_FILE_NAME),
      encoder.encode(
        setAtprotoProjectIdInProjectTomlContents(
          'title = "Bracket"\ndefault_file = "main.kcl"\n',
          remoteProject.id
        )
      )
    )
    const connector: AtprotoOAuthConnector = {
      connect: vi.fn(),
      createProjectApiConfig: vi.fn().mockResolvedValue({ repo, client }),
    }
    const registry = createRegistry({ library, connector })

    try {
      registry.get(projectLibraryTypesValueSpec)
      await vi.waitFor(() =>
        expect(registry.get(homeProjectEntriesValueSpec)).toEqual([
          expect.objectContaining({
            source: 'local',
            status: 'synced',
            localProjectName: 'bracket',
            remoteProjectId: remoteProject.id,
          }),
        ])
      )
    } finally {
      registry[Symbol.dispose]()
      await fsZds.rm(testRoot, { recursive: true, force: true })
    }
  })
})
