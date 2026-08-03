import 'fake-indexeddb/auto'
import {
  cloudSyncRemoteProjects,
  configureCloudSyncEngine,
  duplicateRemoteCloudProject,
} from '@src/lib/cloudSync'
import {
  getFetchMethod,
  getFetchUrl,
  jsonResponse,
} from '@src/lib/cloudSync/testUtils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('uuid', () => ({
  v4: () => 'duplicate-project-uuid',
}))

const baseUrl = 'https://example.test'
const remoteProjectId = 'remote-project-123'
const remoteProjectDownloadUrl = `${baseUrl}/user/projects/${remoteProjectId}/download?format=zip`
const remoteProjectsUrl = `${baseUrl}/user/projects`

const fetchMock = vi.fn<typeof fetch>()

describe('duplicateRemoteCloudProject', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    cloudSyncRemoteProjects.value = [
      { id: remoteProjectId, title: 'Bracket' },
      { id: 'remote-project-1', title: 'Bracket-copy' },
    ]
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: '/documents/Projects',
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    configureCloudSyncEngine({ enabled: false })
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('downloads and creates a distinct remote project without materializing the source', async () => {
    let uploadedBody: unknown
    let uploadedMainKcl: string | undefined
    let uploadedProjectToml: string | undefined
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)

      if (url === remoteProjectDownloadUrl && method === 'GET') {
        return jsonResponse({
          files: [
            { relativePath: 'main.kcl', contents: 'value = 42' },
            {
              relativePath: 'project.toml',
              contents:
                'title = "Bracket"\ndefault_file = "main.kcl"\n\n[settings.meta]\nid = "source-project-uuid"\n\n[cloud."dev.zoo.dev"]\nproject_id = "remote-project-123"\n',
            },
          ],
        })
      }
      if (url === remoteProjectsUrl && method === 'POST') {
        const formData = init?.body as FormData
        uploadedBody = JSON.parse(await (formData.get('body') as Blob).text())
        uploadedMainKcl = await (formData.get('main.kcl') as Blob).text()
        uploadedProjectToml = await (
          formData.get('project.toml') as Blob
        ).text()
        return jsonResponse({
          id: 'duplicated-remote-project',
          title: 'Bracket-copy-1',
          revision: 'rev-1',
        })
      }

      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })

    const result = await duplicateRemoteCloudProject(remoteProjectId, 'Bracket')

    expect(result).toEqual({
      id: 'duplicated-remote-project',
      title: 'Bracket-copy-1',
    })
    expect(
      fetchMock.mock.calls.map(([input, init]) => [
        getFetchMethod(input, init),
        getFetchUrl(input),
      ])
    ).toEqual([
      ['GET', remoteProjectDownloadUrl],
      ['POST', remoteProjectsUrl],
    ])
    expect(uploadedBody).toEqual({
      title: 'Bracket-copy-1',
      description: '',
      category_ids: [],
      entrypoint_path: 'main.kcl',
      project_toml_path: 'project.toml',
    })
    expect(uploadedMainKcl).toBe('value = 42')
    expect(uploadedProjectToml).toBe(
      'title = "Bracket-copy-1"\ndefault_file = "main.kcl"\n\n[settings.meta]\nid = "duplicate-project-uuid"\n'
    )
    expect(cloudSyncRemoteProjects.value).toEqual([
      { id: remoteProjectId, title: 'Bracket' },
      { id: 'remote-project-1', title: 'Bracket-copy' },
      {
        id: 'duplicated-remote-project',
        title: 'Bracket-copy-1',
        revision: 'rev-1',
      },
    ])
  })
})
