import {
  downloadCloudProjectView,
  isValidProjectFilePath,
  resolveCloudProjectSource,
} from '@src/lib/cloudProjectOpen'
import { afterEach, describe, expect, test, vi } from 'vitest'
import JSZip from 'jszip'
import fc from 'fast-check'
import { webSafeJoin } from '@src/lib/pathUtils'

const config = {
  enabled: true,
  baseUrl: 'https://api.example.test',
  token: 'test',
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status })
afterEach(() => vi.unstubAllGlobals())

describe('cloud project access', () => {
  test('accepts relative file paths and rejects parent traversal at every depth', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/), {
          minLength: 1,
          maxLength: 6,
        }),
        (segments) => {
          const file = `${webSafeJoin(segments)}.kcl`
          expect(isValidProjectFilePath(file)).toBe(true)
          for (let index = 0; index <= segments.length; index++) {
            const unsafe = webSafeJoin([
              ...segments.slice(0, index),
              '..',
              ...segments.slice(index),
              'main.kcl',
            ])
            expect(isValidProjectFilePath(unsafe)).toBe(false)
          }
        }
      )
    )
  })
  test.each([true, false, undefined])(
    'uses effective can_edit=%s without creating a copy',
    async (canEdit) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        json({
          id: 'project',
          title: 'Bracket',
          revision: 'v1',
          entrypoint_path: 'parts/main.kcl',
          access: canEdit === undefined ? undefined : { can_edit: canEdit },
        })
      )
      vi.stubGlobal('fetch', fetchMock)
      expect(await resolveCloudProjectSource(config, 'project')).toMatchObject({
        source: { id: 'project', canEdit: canEdit === true, kind: 'private' },
        entrypoint: 'parts/main.kcl',
      })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
    }
  )

  test('falls back to the published project only when private access is denied', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ message: 'Forbidden' }, 403))
      .mockResolvedValueOnce(
        json({ id: 'project', title: 'Published', published_at: 'v1' })
      )
    vi.stubGlobal('fetch', fetchMock)
    expect(await resolveCloudProjectSource(config, 'project')).toEqual({
      source: { id: 'project', canEdit: false, kind: 'public' },
      title: 'Published',
      revision: 'v1',
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/user/projects/project',
      'https://api.example.test/projects/public/project',
    ])
  })

  test('does not interpret a server failure as public access', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ message: 'Unavailable' }, 503))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      resolveCloudProjectSource(config, 'project')
    ).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  test('loads the declared nested entrypoint and rejects a revision race', async () => {
    const zip = new JSZip()
    zip.file('parts/main.kcl', '@settings(kclVersion = 2.0)\nx = 1')
    zip.file('project.toml', 'default_file = "parts/main.kcl"')
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    const source = {
      source: { id: 'project', canEdit: false, kind: 'private' as const },
      title: 'Bracket',
      revision: 'v1',
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(archive))
      .mockResolvedValueOnce(json({ revision: 'v1' }))
      .mockResolvedValueOnce(new Response(archive))
      .mockResolvedValueOnce(json({ revision: 'v2' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await downloadCloudProjectView(config, source, () => {})
    ).toMatchObject({ entrypoint: 'parts/main.kcl' })
    await expect(
      downloadCloudProjectView(config, source, () => {})
    ).rejects.toThrow('changed while opening')
  })

  test.each([
    '../main.kcl',
    '/main.kcl',
    'parts/../../main.kcl',
    'C:\\main.kcl',
  ])('rejects unsafe file selector %s', (file) => {
    expect(isValidProjectFilePath(file)).toBe(false)
  })
})
