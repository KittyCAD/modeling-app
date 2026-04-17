import JSZip from 'jszip'
import { afterEach, describe, expect, test, vi } from 'vitest'

import env from '@src/env'
import {
  createOpenPublicProjectUrl,
  downloadPublicProject,
} from '@src/lib/publicProject'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('public project helpers', () => {
  test('createOpenPublicProjectUrl builds an app URL that can prompt for desktop', () => {
    const result = createOpenPublicProjectUrl('project-123')

    expect(result.toString()).toBe(
      `${env().VITE_ZOO_SITE_APP_URL}/?public-project=project-123&ask-open-desktop=true`
    )
  })

  test('downloadPublicProject parses a zip archive into project files', async () => {
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

    const result = await downloadPublicProject('project-123')

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) {
      throw result
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/projects/public/project-123/download?format=zip'),
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

  test('downloadPublicProject returns an error when the archive has no KCL entry file', async () => {
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

    const result = await downloadPublicProject('project-456')

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('openable KCL entry file')
  })
})
