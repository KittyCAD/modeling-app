import { beforeAll, describe, expect, it } from 'vitest'

import type { ArtifactGraph } from '@src/lang/wasm'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { FileEntry } from '@src/lib/project'
import { constructMultiFileIterationRequestWithPromptHelpers } from '@src/lib/promptToEdit'
import type { FileMeta } from '@src/lib/types'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('constructMultiFileIterationRequestWithPromptHelpers', () => {
  it('marks the currently open file as the default edit target when there is no selection', () => {
    const currentFileEntry: FileEntry = {
      path: '/projects/zoo-project/newFile.kcl',
      name: 'newFile.kcl',
      children: null,
    }
    const projectFiles: FileMeta[] = [
      {
        type: 'kcl',
        relPath: 'main.kcl',
        absPath: '/projects/zoo-project/main.kcl',
        fileContents: 'width = 5\n',
        execStateFileNamesIndex: 0,
      },
      {
        type: 'kcl',
        relPath: 'newFile.kcl',
        absPath: '/projects/zoo-project/newFile.kcl',
        fileContents: 'width = 3\n',
        execStateFileNamesIndex: 1,
      },
    ]

    const request = constructMultiFileIterationRequestWithPromptHelpers({
      prompt: 'change the width to 10',
      selections: null,
      projectFiles,
      applicationProjectDirectory: '/projects',
      artifactGraph: {} as ArtifactGraph,
      projectName: 'zoo-project',
      currentFile: { entry: currentFileEntry, content: 'width = 3\n' },
      kclVersion: '1.0.0',
    })

    expect(request.activeFile).toBe('newFile.kcl')
    const sourceRanges = request.body.source_ranges
    expect(sourceRanges).toHaveLength(1)
    expect(sourceRanges?.[0]).toMatchObject({
      file: 'newFile.kcl',
      prompt: 'This is the active file',
    })
  })

  it('returns a forward-slash activeFile for nested files', () => {
    // activeFile is sent as `active_file` to the ML/Zookeeper service, which
    // matches it against the posix-keyed project files; on Windows the relative
    // path is joined with backslashes, so it must be normalized.
    const currentFileEntry: FileEntry = {
      path: '/projects/zoo-project/parts/bracket.kcl',
      name: 'bracket.kcl',
      children: null,
    }
    const projectFiles: FileMeta[] = [
      {
        type: 'kcl',
        relPath: 'parts/bracket.kcl',
        absPath: '/projects/zoo-project/parts/bracket.kcl',
        fileContents: 'bracket = 1\n',
        execStateFileNamesIndex: 0,
      },
    ]

    const request = constructMultiFileIterationRequestWithPromptHelpers({
      prompt: 'change the bracket',
      selections: null,
      projectFiles,
      applicationProjectDirectory: '/projects',
      artifactGraph: {} as ArtifactGraph,
      projectName: 'zoo-project',
      currentFile: { entry: currentFileEntry, content: 'bracket = 1\n' },
      kclVersion: '1.0.0',
    })

    expect(request.activeFile).toBe('parts/bracket.kcl')
    expect(request.activeFile).not.toContain('\\')
  })
})
