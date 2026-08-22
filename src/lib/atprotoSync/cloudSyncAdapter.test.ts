import type { AtprotoProjectApiConfig } from '@src/lib/atprotoSync/api'
import {
  atprotoCloudSyncProjectBinding,
  createAtprotoCloudSyncRemoteApi,
} from '@src/lib/atprotoSync/cloudSyncAdapter'
import { AtprotoXrpcError } from '@src/lib/atprotoSync/xrpcClient'
import type { ProjectArchiveFile } from '@src/lib/cloudSync'
import { describe, expect, it } from 'vitest'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const projectId = 'at://did:plc:frank/nyc.noirot.cad.project/project-rkey'

function projectFile(
  relativePath: string,
  contents: string
): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

function projectToml(files: ProjectArchiveFile[]) {
  return decoder.decode(
    files.find((file) => file.relativePath === 'project.toml')?.data
  )
}

describe('ATProto cloud sync adapter', () => {
  it('binds remote project IDs through the ATProto project.toml table', () => {
    const contents =
      atprotoCloudSyncProjectBinding.setProjectIdInProjectTomlContents(
        'title = "Bracket"\n',
        projectId,
        { enabled: true }
      )

    expect(
      atprotoCloudSyncProjectBinding.readProjectTomlBinding(contents, {
        enabled: true,
      })
    ).toEqual({
      kind: 'current-environment',
      projectId,
    })
    expect(
      atprotoCloudSyncProjectBinding.removeProjectIdFromProjectTomlContents(
        contents,
        { enabled: true }
      )
    ).not.toContain('atproto')
  })

  it('adds ATProto project metadata to materialized remote archives', () => {
    const files =
      atprotoCloudSyncProjectBinding.withRemoteProjectMetadataInArchiveFiles(
        [projectFile('project.toml', 'title = "Bracket"\n')],
        'Housing',
        projectId,
        { enabled: true }
      )

    expect(projectToml(files)).toContain('title = "Housing"')
    expect(projectToml(files)).toContain(`project_id = "${projectId}"`)
  })

  it('classifies ATProto XRPC errors for the generalized sync engine', () => {
    const remoteApi = createAtprotoCloudSyncRemoteApi({
      repo: 'did:plc:frank',
      client: {},
    } as AtprotoProjectApiConfig)
    const notFound = new AtprotoXrpcError(404, 'not found')
    const forbidden = new AtprotoXrpcError(403, 'forbidden', {
      retryAfterMs: 2500,
    })

    expect(remoteApi.isNotFoundError?.(notFound)).toBe(true)
    expect(remoteApi.isRemoteUploadForbiddenError?.(forbidden)).toBe(true)
    expect(remoteApi.retryAfterMs?.(forbidden)).toBe(2500)
  })
})
