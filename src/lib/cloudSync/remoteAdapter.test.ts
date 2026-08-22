import 'fake-indexeddb/auto'
import { atprotoCloudSyncProjectBinding } from '@src/lib/atprotoSync'
import {
  type CloudSyncRemoteProjectApi,
  configureCloudSyncEngine,
  type ProjectArchiveFile,
  renameRemoteCloudProject,
} from '@src/lib/cloudSync'
import { deleteCloudSyncTestDatabase } from '@src/lib/cloudSync/testUtils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const remoteProjectId = 'at://did:plc:frank/nyc.noirot.cad.project/project-rkey'

function jsonArchiveBuffer(
  files: { relativePath: string; contents: string }[]
) {
  const bytes = encoder.encode(JSON.stringify({ files }))
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

function readProjectToml(files: ProjectArchiveFile[]) {
  return decoder.decode(
    files.find((file) => file.relativePath === 'project.toml')?.data
  )
}

describe('cloud sync remote adapters', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    await deleteCloudSyncTestDatabase()
  })

  it('uses configured remote APIs and project bindings for remote-only renames', async () => {
    let uploadedFiles: ProjectArchiveFile[] | undefined
    const remoteApi: CloudSyncRemoteProjectApi = {
      listRemoteProjects: vi.fn(),
      getRemoteProject: vi.fn().mockResolvedValue({
        id: remoteProjectId,
        title: 'Bracket',
        revision: 'project-cid',
      }),
      deleteRemoteProject: vi.fn(),
      downloadRemoteProjectArchive: vi.fn().mockResolvedValue(
        jsonArchiveBuffer([
          { relativePath: 'main.kcl', contents: 'foo = 1' },
          { relativePath: 'project.toml', contents: 'title = "Bracket"\n' },
        ])
      ),
      createRemoteProject: vi.fn(),
      updateRemoteProject: vi.fn(async ({ files }) => {
        uploadedFiles = files
        return {
          id: remoteProjectId,
          title: 'Housing',
          revision: 'project-cid-2',
        }
      }),
    }
    configureCloudSyncEngine({
      enabled: true,
      remoteApi,
      projectBinding: atprotoCloudSyncProjectBinding,
      cloudProjectDirectoryPaths: ['/documents/ATProto'],
      autoEnrollCloudLibraryProjects: false,
    })

    await renameRemoteCloudProject(remoteProjectId, 'Housing')

    expect(remoteApi.updateRemoteProject).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 'project-cid',
        project: expect.objectContaining({
          id: remoteProjectId,
        }),
      })
    )
    expect(readProjectToml(uploadedFiles ?? [])).toContain(
      `project_id = "${remoteProjectId}"`
    )
  })
})
