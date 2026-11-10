import JSZip from 'jszip'
import { afterEach, describe, expect, test, vi } from 'vitest'

import env from '@src/env'
import {
  getProjectArchiveEntrypointPath,
  parseProjectArchive,
} from '@src/lib/fs-zds/cloud/archive'
import {
  createOpenProjectIdUrl,
  downloadProjectById,
  getPublicProjectNameById,
} from '@src/lib/fs-zds/cloud/publicProject'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('downloadProject helpers', () => {
  test('returns an Error for a malformed ZIP instead of rejecting the caller', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not a ZIP')
    )
    await expect(downloadProjectById('invalid')).resolves.toBeInstanceOf(Error)
  })

  test('returns an Error for malformed encoded download filenames', async () => {
    const zip = new JSZip()
    zip.file('main.kcl', '')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(await zip.generateAsync({ type: 'arraybuffer' }), {
        headers: {
          'content-disposition': "attachment; filename*=UTF-8''%ZZ.zip",
        },
      })
    )
    await expect(downloadProjectById('invalid')).resolves.toBeInstanceOf(Error)
  })

  test.each([
    {
      paths: ['z.kcl', 'a.kcl'],
      configured: undefined,
      imported: 'z.kcl',
      cloud: 'a.kcl',
    },
    {
      paths: ['UPPER.KCL'],
      configured: undefined,
      imported: undefined,
      cloud: 'UPPER.KCL',
    },
    {
      paths: ['z.kcl', 'main.kcl', 'a.kcl'],
      configured: 'a.kcl',
      imported: 'a.kcl',
      cloud: 'a.kcl',
    },
    {
      paths: ['z.kcl', 'main.kcl'],
      configured: 'missing.kcl',
      imported: 'main.kcl',
      cloud: 'main.kcl',
    },
  ])(
    'preserves separate entrypoint policies for $paths with default $configured',
    async ({ paths, configured, imported, cloud }) => {
      const zip = new JSZip()
      for (const path of paths) zip.file(path, '@settings(kclVersion = 3.0)\n')
      if (configured) zip.file('project.toml', `default_file = "${configured}"`)
      const archive = await zip.generateAsync({ type: 'arraybuffer' })
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(archive))
      const result = await downloadProjectById('project-123')
      if (imported === undefined) expect(result).toBeInstanceOf(Error)
      else {
        if (result instanceof Error) throw result
        expect(result.entrypointFilePath).toBe(imported)
      }
      const files = await parseProjectArchive(archive)
      expect(getProjectArchiveEntrypointPath(files)).toBe(cloud)
    }
  )

  test('strips the public import root while retaining cloud paths and binary bytes', async () => {
    const zip = new JSZip()
    zip.file('sample/main.kcl', '@settings(kclVersion = 3.0)\n')
    zip.file('sample/assets/shape.stl', new Uint8Array([0, 128, 255]))
    zip.file('__MACOSX/noise.kcl', 'ignored')
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(archive))
    const imported = await downloadProjectById('project-123')
    if (imported instanceof Error) throw imported
    expect(imported.projectName).toBe('sample')
    expect(imported.files.map((file) => file.requestedFileName)).toEqual([
      'main.kcl',
      'assets/shape.stl',
    ])
    expect([...imported.files[1].requestedData]).toEqual([0, 128, 255])
    const cloud = await parseProjectArchive(archive)
    expect(cloud.map((file) => file.relativePath)).toEqual([
      'sample/main.kcl',
      'sample/assets/shape.stl',
    ])
    expect([...cloud[1].data]).toEqual([0, 128, 255])
  })

  test('createOpenProjectIdUrl builds an app URL that can prompt for desktop', () => {
    const result = createOpenProjectIdUrl('project-123')

    expect(result.toString()).toBe(
      `${env().VITE_ZOO_SITE_APP_URL}/?project-id=project-123&ask-open-desktop=true`
    )
  })

  test('getPublicProjectNameById reads and sanitizes the public project title', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        categories: [],
        description: '',
        id: 'project-123',
        like_count: 0,
        owner: { username: 'user' },
        published_at: '2026-04-29T00:00:00Z',
        title: 'sample/project',
      })
    )

    const result = await getPublicProjectNameById('project-123')

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/projects/public/project-123'),
      expect.objectContaining({
        method: 'GET',
      })
    )
    expect(result).toBe('sample-project')
  })

  test('downloadProjectById parses a zip archive into project files', async () => {
    const zip = new JSZip()
    zip.file('sample-project/main.kcl', 'part001 = startSketchOn("XY")')
    zip.file('sample-project/project.toml', 'default_file = "main.kcl"')
    zip.file('sample-project/assets/shape.stl', new Uint8Array([1, 2, 3]))

    const archive = await zip.generateAsync({ type: 'arraybuffer' })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(archive, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="sample-project.zip"',
        },
      })
    )

    const result = await downloadProjectById('project-123')

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) {
      throw result
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '/projects/public/project-123/download?format=zip'
      ),
      expect.objectContaining({
        method: 'GET',
      })
    )
    expect(result.projectName).toBe('sample-project')
    expect(result.entrypointFilePath).toBe('main.kcl')
    expect(result.files.map((file) => file.requestedFileName)).toEqual([
      'main.kcl',
      'project.toml',
      'assets/shape.stl',
    ])
    expect(Array.from(result.files[2].requestedData)).toEqual([1, 2, 3])
  })

  test('downloadProjectById returns an error when the archive has no KCL entry file', async () => {
    const zip = new JSZip()
    zip.file('sample-project/project.toml', 'default_file = "main.kcl"')
    zip.file('sample-project/assets/shape.stl', new Uint8Array([1, 2, 3]))

    const archive = await zip.generateAsync({ type: 'arraybuffer' })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(archive, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="sample-project.zip"',
        },
      })
    )

    const result = await downloadProjectById('project-456')

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('openable KCL entry file')
  })
})
