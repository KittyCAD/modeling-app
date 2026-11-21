import { Client } from '@kittycad/lib'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock('@src/lib/kcClient', () => ({
  createKCClient: () =>
    new Client({
      token: 'test',
      baseUrl: 'https://api.example.test',
      fetch: mocks.fetch,
    }),
}))

import {
  createFactoryRequests,
  factoryProjectJobBody,
} from '@src/lib/factory/api'

beforeEach(() => {
  mocks.fetch.mockReset()
})

const part = {
  entrypoint: 'parts/bracket.kcl',
  material: 'Aluminum',
  finish: 'Anodized',
  quantity: 5,
  notes: 'Deburr',
}
const snapshot = {
  projectId: 'source-project',
  versionId: 'source-version',
  files: [
    { relativePath: 'main.kcl', data: new TextEncoder().encode('main') },
    {
      relativePath: 'parts/bracket.kcl',
      data: new TextEncoder().encode('bracket'),
    },
    { relativePath: 'data/input.csv', data: new Uint8Array([0, 1, 255]) },
  ],
}
const delivery = {
  shipping_address_revision_id: 'revision-not-card-id',
  is_expedited: true,
}

it.each(['parts/bracket.kcl', 'parts/bracket.STEP', 'parts/bracket.stp'])(
  'selects %s while referencing the same saved Project version',
  (entrypoint) => {
    expect(
      factoryProjectJobBody({ ...part, entrypoint }, snapshot, delivery)
    ).toEqual({
      project_id: 'source-project',
      project_version_id: 'source-version',
      entrypoint_path: entrypoint,
      fields: {
        material: 'Aluminum',
        finish: 'Anodized',
        quantity: 5,
        notes: 'Deburr',
      },
      shipping_address_revision_id: 'revision-not-card-id',
      is_expedited: true,
    })
  }
)

it('revises organization jobs through the supported endpoint without replacing their files or delivery', async () => {
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ id: 'job-one', status: 'quoting' }), {
      status: 201,
    })
  )
  const result = await createFactoryRequests('token', true).revise(
    { id: 'job-one', status: 'new', part },
    { ...part, quantity: 10 }
  )
  expect(result).toEqual({ ok: true, id: 'job-one', status: 'quoting' })
  const [url, init] = mocks.fetch.mock.calls.at(-1)!
  expect(url).toBe('https://api.example.test/org/factory/jobs/job-one/versions')
  expect(init?.method).toBe('POST')
  const body = init?.body
  expect(body).toBeInstanceOf(FormData)
  if (!(body instanceof FormData)) return
  expect([...body.keys()]).toEqual(['body'])
  const metadata = body.get('body')
  expect(metadata).toBeInstanceOf(Blob)
  if (!(metadata instanceof Blob)) return
  expect(JSON.parse(await metadata.text())).toEqual({
    fields: {
      material: 'Aluminum',
      finish: 'Anodized',
      quantity: 10,
      notes: 'Deburr',
    },
    removed_files: [],
  })
})

it.each([400, 409, 503])(
  'classifies an HTTP %i without retrying the write',
  async (status) => {
    mocks.fetch.mockClear()
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Request failed' }), { status })
    )
    const result = await createFactoryRequests('token', false).create(
      part,
      snapshot,
      delivery
    )
    expect(result).toEqual({
      ok: false,
      uncertain: status === 503,
      message:
        status === 503
          ? 'The response could not be confirmed. Check Manufacturing Jobs on zoo.dev before submitting again to avoid duplicates.'
          : 'Request failed',
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  }
)

it('treats transport failures as uncertain', async () => {
  mocks.fetch.mockRejectedValueOnce(new TypeError('Network unavailable'))
  const result = await createFactoryRequests('token', false).create(
    part,
    snapshot,
    delivery
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.uncertain).toBe(true)
})

it('rejects an older server without falling back to automatic entry point selection', async () => {
  mocks.fetch.mockResolvedValueOnce(new Response('', { status: 404 }))
  const result = await createFactoryRequests('token', false).create(
    part,
    snapshot,
    delivery
  )
  expect(result).toEqual({
    ok: false,
    uncertain: false,
    message: 'Factory project submissions are not available on this server.',
  })
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
  expect(mocks.fetch.mock.calls[0][0]).toBe(
    'https://api.example.test/user/factory/project-jobs'
  )
})

it('submits a selected part without copying or uploading the Project', async () => {
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ id: 'new-job', status: 'new' }), {
      status: 201,
    })
  )
  const result = await createFactoryRequests('token', false).create(
    part,
    snapshot,
    delivery
  )
  expect(result).toEqual({ ok: true, id: 'new-job', status: 'new' })
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
  const [url, init] = mocks.fetch.mock.calls[0]
  expect(url).toBe('https://api.example.test/user/factory/project-jobs')
  expect(init?.method).toBe('POST')
  expect(init?.headers).toEqual({
    Authorization: 'Bearer test',
    'Content-Type': 'application/json',
  })
  expect(typeof init?.body).toBe('string')
  if (typeof init?.body !== 'string') return
  expect(JSON.parse(init.body)).toEqual({
    project_id: 'source-project',
    project_version_id: 'source-version',
    entrypoint_path: 'parts/bracket.kcl',
    fields: {
      material: 'Aluminum',
      finish: 'Anodized',
      quantity: 5,
      notes: 'Deburr',
    },
    shipping_address_revision_id: 'revision-not-card-id',
    is_expedited: true,
  })
})
