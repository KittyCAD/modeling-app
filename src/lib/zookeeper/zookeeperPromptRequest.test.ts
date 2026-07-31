import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { FileEntry } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  constructZookeeperPromptToEditRequest,
  zookeeperArtifactSelectionPromptHandlers,
  zookeeperArtifactTypes,
} from '@src/lib/zookeeper/zookeeperPromptRequest'
import type { KclManager } from '@src/lang/KclManager'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('constructZookeeperPromptToEditRequest', () => {
  const userPrompt = 'change the selected thing'
  const unusedSelectionReferenceDependencies = {
    kclManager: {} as KclManager,
    engineCommandManager: {} as ConnectionManager,
    wasmInstance: {} as ModuleType,
  }

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
      prompt: userPrompt,
      selections,
      projectFiles: makeProjectFiles(code),
      applicationProjectDirectory: '/projects',
      artifactGraph,
      projectName: 'zoo-project',
      currentFile: { entry: currentFileEntry, content: code },
      kclVersion: '1.0.0',
      ...unusedSelectionReferenceDependencies,
    })

  it('marks the currently open file as the default edit target when there is no selection', async () => {
    const code = 'width = 5\n'
    const request = await makeRequest({ code, selections: null })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(request.activeFile).toBe('main.kcl')
    expect(request.body.prompt).toBe(userPrompt)
    expect(request.body.source_ranges).toHaveLength(1)
    expect(request.body.source_ranges?.[0]).toMatchObject({
      file: 'main.kcl',
      prompt: 'This is the active file',
    })
  })

  it('returns a forward-slash active file for nested files', async () => {
    const request = await constructZookeeperPromptToEditRequest({
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
      ...unusedSelectionReferenceDependencies,
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(request.activeFile).toBe('parts/bracket.kcl')
    expect(request.activeFile).not.toContain('\\')
  })

  it('marks the active file as the default edit target when selection data has no graph selections', async () => {
    const code = 'width = 5\n'
    const request = await makeRequest({
      code,
      selections: {
        graphSelections: [],
        otherSelections: [],
      },
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(request.activeFile).toBe('main.kcl')
    expect(request.body.prompt).toBe(userPrompt)
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

  it('keeps manual selection prompts out of the visible user prompt', async () => {
    const code = 'selected = 5\n'
    const request = await makeRequest({
      code,
      selections: {
        otherSelections: [],
        graphSelections: [
          {
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

    expect(request.body.prompt).toBe(userPrompt)
    expect(request.body.source_ranges).toStrictEqual([
      {
        file: 'main.kcl',
        prompt: 'This is the source range selected by the user.',
        range: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: code.length - 1 },
        },
      },
    ])
  })

  it.each(zookeeperArtifactTypes)(
    'serializes selected %s artifact prompts without changing visible prompt',
    async (artifactType) => {
      const code = 'selected = 5\n'
      const request = await makeRequest({
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

      expect(request.body.prompt).toBe(userPrompt)
      expect(request.body.source_ranges).toHaveLength(1)
      expect(request.body.source_ranges?.[0].prompt).not.toBe(userPrompt)
      expect(request.body.source_ranges?.[0]).toMatchObject({
        file: 'main.kcl',
        range: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: code.length - 1 },
        },
      })
    }
  )

  it('returns an error instead of sending empty source ranges for stale graph selections', async () => {
    const request = await makeRequest({
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
