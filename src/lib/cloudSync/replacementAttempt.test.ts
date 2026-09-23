import { projectManifestFromFiles } from '@src/lib/cloudSync/projectArchive'
import { createProjectReplacementAttempt } from '@src/lib/cloudSync/replacementAttempt'
import type { ProjectArchiveFile } from '@src/lib/cloudSync/types'
import { describe, expect, it } from 'vitest'

const encoder = new TextEncoder()

function projectFile(
  relativePath: string,
  contents: string
): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

describe('createProjectReplacementAttempt', () => {
  it('binds copied upload bytes and their deletions to one expected revision', async () => {
    const baseFiles = [
      projectFile('main.kcl', 'main = 1\n'),
      projectFile('obsolete.kcl', 'obsolete = 1\n'),
    ]
    const nextFile = projectFile('main.kcl', 'main = 2\n')
    const attempt = await createProjectReplacementAttempt({
      projectPath: '/documents/Projects/bracket',
      project: { id: 'project-1' },
      files: [nextFile],
      syncBase: {
        revision: 'revision-1',
        manifest: await projectManifestFromFiles(baseFiles),
      },
    })

    nextFile.data.fill(0)

    expect(new TextDecoder().decode(attempt.files[0].data)).toBe('main = 2\n')
    expect(attempt.manifest).toEqual(
      await projectManifestFromFiles([projectFile('main.kcl', 'main = 2\n')])
    )
    expect(attempt.expectedRevision).toBe('revision-1')
    expect(attempt.deletedPaths).toEqual(['obsolete.kcl'])
  })
})
