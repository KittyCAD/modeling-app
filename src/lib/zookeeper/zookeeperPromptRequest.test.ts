import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { FileEntry } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'
import { isErr } from '@src/lib/trap'
import {
  constructZookeeperPromptToEditRequest,
  zookeeperArtifactSelectionPromptHandlers,
  zookeeperArtifactTypes,
} from '@src/lib/zookeeper/zookeeperPromptRequest'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('constructZookeeperPromptToEditRequest', () => {
  const currentFileEntry: FileEntry = {
    path: '/projects/zoo-project/main.kcl',
    name: 'main.kcl',
    children: null,
  }

  const makeProjectFiles = (code: string): FileMeta[] => [
    {
      type: 'kcl',
      relPath: 'main.kcl',
      absPath: '/projects/zoo-project/main.kcl',
      fileContents: code,
      execStateFileNamesIndex: 0,
    },
  ]

  const makeRequest = ({
    code,
    selections,
    artifactGraph = new Map(),
  }: {
    code: string
    selections: Selections | null
    artifactGraph?: ArtifactGraph
  }) =>
    constructZookeeperPromptToEditRequest({
      prompt: 'change the selected thing',
      selections,
      projectFiles: makeProjectFiles(code),
      applicationProjectDirectory: '/projects',
      artifactGraph,
      projectName: 'zoo-project',
      currentFile: { entry: currentFileEntry, content: code },
      kclVersion: '1.0.0',
    })

  it('marks the currently open file as the default edit target when there is no selection', () => {
    const code = 'width = 5\n'
    const request = makeRequest({ code, selections: null })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(request.activeFile).toBe('main.kcl')
    expect(request.body.source_ranges).toHaveLength(1)
    expect(request.body.source_ranges?.[0]).toMatchObject({
      file: 'main.kcl',
      prompt: 'This is the active file',
    })
  })

  it('returns a forward-slash active file for nested files', () => {
    const request = constructZookeeperPromptToEditRequest({
      prompt: 'change the bracket',
      selections: null,
      projectFiles: [
        {
          type: 'kcl',
          relPath: 'parts/bracket.kcl',
          absPath: '/projects/zoo-project/parts/bracket.kcl',
          fileContents: 'bracket = 1\n',
          execStateFileNamesIndex: 0,
        },
      ],
      applicationProjectDirectory: '/projects',
      artifactGraph: new Map(),
      projectName: 'zoo-project',
      currentFile: {
        entry: {
          path: '/projects/zoo-project/parts/bracket.kcl',
          name: 'bracket.kcl',
          children: null,
        },
        content: 'bracket = 1\n',
      },
      kclVersion: '1.0.0',
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(request.activeFile).toBe('parts/bracket.kcl')
    expect(request.activeFile).not.toContain('\\')
  })

  it('marks the active file as the default edit target when selection data has no graph selections', () => {
    const code = 'width = 5\n'
    const request = makeRequest({
      code,
      selections: {
        graphSelections: [],
        otherSelections: [],
      },
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(request.activeFile).toBe('main.kcl')
    expect(request.body.source_ranges).toHaveLength(1)
    expect(request.body.source_ranges?.[0]).toMatchObject({
      file: 'main.kcl',
      prompt: 'This is the active file',
    })
  })

  it('has an explicit handler for every generated artifact type', () => {
    expect(
      Object.keys(zookeeperArtifactSelectionPromptHandlers).sort()
    ).toEqual([...zookeeperArtifactTypes].sort())
  })

  it.each(zookeeperArtifactTypes)(
    'serializes selected %s artifacts',
    (artifactType) => {
      const code = 'selected = 5\n'
      const request = makeRequest({
        code,
        selections: {
          otherSelections: [],
          graphSelections: [
            {
              artifact: { type: artifactType } as Artifact,
              codeRef: {
                range: [0, code.length - 1, 0],
                pathToNode: [],
              },
            },
          ],
        },
      })

      expect(isErr(request)).toBe(false)
      if (isErr(request)) return

      expect(request.body.source_ranges).toHaveLength(1)
      expect(request.body.source_ranges?.[0]).toMatchObject({
        file: 'main.kcl',
        range: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: code.length - 1 },
        },
      })
    }
  )

  it('returns an error instead of sending empty source ranges for stale graph selections', () => {
    const request = makeRequest({
      code: 'width = 5\n',
      selections: {
        otherSelections: [],
        graphSelections: [
          {
            codeRef: {
              range: [0, 5, 42],
              pathToNode: [],
            },
          },
        ],
      },
    })

    expect(isErr(request)).toBe(true)
    if (!isErr(request)) return

    expect(request.message).toMatch(/no KCL file found/)
  })
})
