import { afterEach, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { loadDevAccountConfig } from '@src/lib/appConfiguration/project'

const request = {
  accountId: 'dev-user',
  projectId: 'config-project',
  token: 'test-token',
  baseUrl: 'https://api.example.test',
}
const contents = 'schema-version = 1\nbase = "zoo:default"'
afterEach(() => vi.unstubAllGlobals())

it('downloads only app.toml from the resolved immutable Project version using the current auth', async () => {
  const zip = new JSZip().file('app.toml', contents)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(contents)
  )
  const sha256 = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ id: request.projectId, revision: 'version-1' })
    )
    .mockResolvedValueOnce(
      Response.json({
        id: 'version-1',
        files: [
          {
            id: 'manifest-file',
            relative_path: 'app.toml',
            byte_size: contents.length,
            sha256,
          },
        ],
      })
    )
    .mockResolvedValueOnce(
      new Response(await zip.generateAsync({ type: 'arraybuffer' }))
    )
  vi.stubGlobal('fetch', fetch)
  const abort = new AbortController()
  expect(await loadDevAccountConfig(request, abort.signal)).toEqual({
    contents,
    revision: 'version-1',
  })
  const [url, init] = fetch.mock.calls[2]
  expect(new URL(String(url)).pathname).toBe(
    '/user/projects/config-project/versions/version-1/download'
  )
  expect(new URL(String(url)).searchParams.get('file_ids')).toBe(
    'manifest-file'
  )
  expect(new Headers(init?.headers).get('Authorization')).toBe(
    'Bearer test-token'
  )
  expect(init?.signal).toBe(abort.signal)
})

it('rejects missing manifests before downloading unrelated project files', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ id: request.projectId, revision: 'version-1' })
    )
    .mockResolvedValueOnce(
      Response.json({
        id: 'version-1',
        files: [
          { id: 'design-file', relative_path: 'main.kcl', byte_size: 20 },
        ],
      })
    )
  vi.stubGlobal('fetch', fetch)
  await expect(
    loadDevAccountConfig(request, new AbortController().signal)
  ).rejects.toThrow('app.toml at its root')
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('rejects a manifest whose bytes differ from the Project digest', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ id: request.projectId, revision: 'version-1' })
    )
    .mockResolvedValueOnce(
      Response.json({
        id: 'version-1',
        files: [
          {
            id: 'manifest-file',
            relative_path: 'app.toml',
            byte_size: contents.length,
            sha256: '0'.repeat(64),
          },
        ],
      })
    )
    .mockResolvedValueOnce(
      new Response(
        await new JSZip()
          .file('app.toml', contents)
          .generateAsync({ type: 'arraybuffer' })
      )
    )
  vi.stubGlobal('fetch', fetch)
  await expect(
    loadDevAccountConfig(request, new AbortController().signal)
  ).rejects.toThrow('digest')
})
