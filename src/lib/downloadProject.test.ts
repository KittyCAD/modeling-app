import JSZip from 'jszip'
import { afterEach, describe, expect, test, vi } from 'vitest'

import env from '@src/env'
import {
  createOpenProjectIdUrl,
  downloadProjectById,
  getPublicProjectNameById,
} from '@src/lib/downloadProject'

afterEach(() => {
  vi.restoreAllMocks()
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
