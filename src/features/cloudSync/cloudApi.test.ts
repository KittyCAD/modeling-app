import { createCloudApi } from '@src/features/cloudSync/cloudApi'
import { describe, expect, it, vi } from 'vitest'

const response = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('cloud API', () => {
  it('creates an archive project with a manifest and bearer credentials', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ id: 'project-1', revision: '1' }))
    const api = createCloudApi({
      baseUrl: 'https://api.example.test/',
      token: () => 'secret-token',
      fetch: request,
    })

    await api.createProject('/cloud/bracket', [
      {
        relativePath: 'main.kcl',
        data: new TextEncoder().encode('cube = startSketchOn(XY)'),
      },
    ])

    const [url, init] = request.mock.calls[0]
    expect(url).toBe('https://api.example.test/user/projects')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer secret-token'
    )
    const form = init?.body as FormData
    expect(form.get('main.kcl')).toBeInstanceOf(Blob)
    expect(form.get('project.toml')).toBeInstanceOf(Blob)
    const body = JSON.parse(await (form.get('body') as Blob).text())
    expect(body).toMatchObject({
      title: 'bracket',
      entrypoint_path: 'main.kcl',
      project_toml_path: 'project.toml',
    })
  })

  it('guards replacements with the last acknowledged revision', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ id: 'project 1', revision: '8' }))
    const api = createCloudApi({
      baseUrl: 'https://api.example.test',
      token: () => 'token',
      fetch: request,
    })

    await api.updateProject(
      {
        id: 'project 1',
        revision: '7',
        description: 'A bracket',
        category_ids: ['hardware'],
      },
      '/cloud/bracket',
      [
        {
          relativePath: 'main.kcl',
          data: new TextEncoder().encode('updated'),
        },
      ],
      '7/opaque'
    )

    const [url, init] = request.mock.calls[0]
    expect(url).toBe(
      'https://api.example.test/user/projects/project%201?expected_revision=7%2Fopaque'
    )
    const body = JSON.parse(
      await ((init?.body as FormData).get('body') as Blob).text()
    )
    expect(body).toMatchObject({
      expected_revision: '7/opaque',
      description: 'A bracket',
      category_ids: ['hardware'],
    })
  })
})
