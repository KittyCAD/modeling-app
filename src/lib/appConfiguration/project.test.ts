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

it('loads a selected logo from the same immutable version as app.toml without fetching unrelated files', async () => {
  const contents = `schema-version = 1
base = "zoo:default"
[extensions]
exclude = ["zoo:appLogo"]
add = ["personal:logo"]
[sources."personal:logo"]
kind = "project"
entrypoint = "extensions/personal-logo.zds.ts"`
  const source =
    '/* @zds-plugin\nid = "logo"\nname = "Logo"\napi_version = 1\npermissions = []\n*/\nexport default () => {}'
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
          },
          {
            id: 'logo-file',
            relative_path: 'extensions/personal-logo.zds.ts',
            byte_size: source.length,
          },
          { id: 'design-file', relative_path: 'main.kcl', byte_size: 100 },
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
    .mockResolvedValueOnce(
      new Response(
        await new JSZip()
          .file('extensions/personal-logo.zds.ts', source, {
            createFolders: false,
          })
          .generateAsync({ type: 'arraybuffer' })
      )
    )
  vi.stubGlobal('fetch', fetch)
  const loaded = await loadDevAccountConfig(
    request,
    new AbortController().signal
  )
  expect(loaded.sources).toEqual([
    expect.objectContaining({
      id: 'personal:logo',
      projectId: request.projectId,
      versionId: 'version-1',
      contents: source,
    }),
  ])
  const [url] = fetch.mock.calls[3]
  expect(new URL(String(url)).pathname).toBe(
    '/user/projects/config-project/versions/version-1/download'
  )
  expect(new URL(String(url)).searchParams.get('file_ids')).toBe('logo-file')
  expect(fetch).toHaveBeenCalledTimes(4)
})

it('does not download unselected authored sources', async () => {
  const contents = `schema-version = 1
base = "zoo:default"
[sources."personal:unused"]
kind = "project"
entrypoint = "unused.zds.ts"`
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
  expect(
    (await loadDevAccountConfig(request, new AbortController().signal)).sources
  ).toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('resolves an external source by its declared version and verifies its declared digest', async () => {
  const external = '019a1111-2222-7333-8444-555555555555'
  const contents = `schema-version = 1
base = "zoo:default"
[extensions]
add = ["personal:logo"]
[sources."personal:logo"]
kind = "project"
project_id = "${external}"
version_id = "pinned-version"
entrypoint = "logo.zds.ts"
sha256 = "${'0'.repeat(64)}"`
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
    .mockResolvedValueOnce(
      Response.json({
        id: 'pinned-version',
        files: [
          { id: 'logo-file', relative_path: 'logo.zds.ts', byte_size: 10 },
        ],
      })
    )
    .mockResolvedValueOnce(
      new Response(
        await new JSZip()
          .file('logo.zds.ts', 'changed source')
          .generateAsync({ type: 'arraybuffer' })
      )
    )
  vi.stubGlobal('fetch', fetch)
  await expect(
    loadDevAccountConfig(request, new AbortController().signal)
  ).rejects.toThrow('SHA-256 digest')
  expect(new URL(String(fetch.mock.calls[3][0])).pathname).toBe(
    `/user/projects/${external}/versions/pinned-version`
  )
  expect(new URL(String(fetch.mock.calls[4][0])).pathname).toBe(
    `/user/projects/${external}/versions/pinned-version/download`
  )
})
