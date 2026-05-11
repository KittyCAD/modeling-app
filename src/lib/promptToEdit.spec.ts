import { describe, expect, it } from 'vitest'

import type { ArtifactGraph } from '@src/lang/wasm'
import type { FileEntry } from '@src/lib/project'
import { constructMultiFileIterationRequestWithPromptHelpers } from '@src/lib/promptToEdit'
import type { FileMeta } from '@src/lib/types'

describe('constructMultiFileIterationRequestWithPromptHelpers', () => {
  it('marks the currently open file as the default edit target when there is no selection', () => {
    const currentFileEntry: FileEntry = {
      path: '/project/newFile.kcl',
      name: 'newFile.kcl',
      children: null,
    }
    const projectFiles: FileMeta[] = [
      {
        type: 'kcl',
        relPath: 'main.kcl',
        absPath: '/project/main.kcl',
        fileContents: 'width = 5\n',
        execStateFileNamesIndex: 0,
      },
      {
        type: 'kcl',
        relPath: 'newFile.kcl',
        absPath: '/project/newFile.kcl',
        fileContents: 'width = 3\n',
        execStateFileNamesIndex: 1,
      },
    ]

    const request = constructMultiFileIterationRequestWithPromptHelpers({
      prompt: 'change the width to 10',
      selections: null,
      projectFiles,
      applicationProjectDirectory: '/project',
      artifactGraph: {} as ArtifactGraph,
      projectName: 'zoo-project',
      currentFile: { entry: currentFileEntry, content: 'width = 3\n' },
      kclVersion: '1.0.0',
    })

    expect(request.activeFile).toBe('newFile.kcl')
    expect(request.body.source_ranges).toHaveLength(1)
    expect(request.body.source_ranges[0]).toMatchObject({
      file: 'newFile.kcl',
    })
    expect(request.body.source_ranges[0].prompt).toContain(
      'default edit target'
    )
    expect(request.body.source_ranges[0].prompt).toContain(
      'before other project files'
    )
  })
})
