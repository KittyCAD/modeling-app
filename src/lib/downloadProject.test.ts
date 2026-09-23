import JSZip from 'jszip'
import { afterEach, describe, expect, test, vi } from 'vitest'

import env from '@src/env'
import {
  createOpenProjectIdUrl,
  downloadProjectById,
  getPublicProjectNameById,
  parseProjectZipArchive,
} from '@src/lib/downloadProject'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('project ZIP import', () => {
  test('preserves nested files, binary assets, and the configured entrypoint', async () => {
    const zip = new JSZip()
    zip.file('assembly/main.kcl', 'size = 1mm\n')
    zip.file('assembly/design/entry.kcl', 'size = 2mm\n')
    zip.file('assembly/project.toml', 'default_file = "./design/entry.kcl"\n')
    zip.file('assembly/assets/part.step', new Uint8Array([0, 128, 255]))
    zip.file('assembly/.DS_Store', 'ignored')
    zip.file('__MACOSX/assembly/._main.kcl', 'ignored')
    const result = await parseProjectZipArchive({
      archive: await zip.generateAsync({ type: 'arraybuffer' }),
      fileName: 'export.zip',
    })
    if (result instanceof Error) throw result

    expect(result.projectName).toBe('assembly')
    expect(result.entrypointFilePath).toBe('design/entry.kcl')
    expect(result.files.map((file) => file.requestedFileName)).toEqual([
      'main.kcl',
      'design/entry.kcl',
      'project.toml',
      'assets/part.step',
    ])
    expect(result.files[3].requestedData).toEqual(new Uint8Array([0, 128, 255]))
  })

  test('uses the ZIP filename for an archive without a wrapper folder', async () => {
    const zip = new JSZip().file('main.kcl', 'size = 1mm\n')
    const result = await parseProjectZipArchive({
      archive: await zip.generateAsync({ type: 'arraybuffer' }),
      fileName: 'my-project.zip',
    })
    if (result instanceof Error) throw result
    expect(result.projectName).toBe('my-project')
    expect(result.entrypointFilePath).toBe('main.kcl')
  })

  test.each([
    '../outside.kcl',
    '/absolute.kcl',
    'C:\\outside.kcl',
    'parts\\..\\outside.kcl',
  ])('rejects unsafe original archive paths: %s', async (path) => {
    const zip = new JSZip()
      .file('main.kcl', 'size = 1mm\n')
      .file(path, 'size = 2mm\n')
    const result = await parseProjectZipArchive({
      archive: await zip.generateAsync({ type: 'arraybuffer' }),
    })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('invalid file path')
  })

  test('rejects ZIPs with no KCL project instead of creating an empty project', async () => {
    const zip = new JSZip()
      .file('part.step', new Uint8Array([0, 1, 2]))
      .file('project.toml', 'default_file = "part.step"\n')
    const result = await parseProjectZipArchive({
      archive: await zip.generateAsync({ type: 'arraybuffer' }),
    })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('openable KCL entry file')
  })
})

describe('downloadProject helpers', () => {
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
