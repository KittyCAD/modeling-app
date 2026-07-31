import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { FileEntry } from '@src/lib/project'
import { getSelectionReferences } from '@src/lib/selections'
import type * as SelectionsModule from '@src/lib/selections'
import type { FileMeta } from '@src/lib/types'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  type ArtifactSelectionPromptHandler,
  constructZookeeperUserPromptRequest,
  zookeeperArtifactSelectionPromptHandlers,
} from '@src/lib/zookeeper/zookeeperPromptRequest'
import type { KclManager } from '@src/lang/KclManager'
import type { Selections } from '@src/machines/modelingSharedTypes'

vi.mock('@src/lib/selections', async (importOriginal) => {
  const actual = await importOriginal<typeof SelectionsModule>()
  return {
    ...actual,
    getSelectionReferences: vi.fn(),
  }
})

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('constructZookeeperUserPromptRequest', () => {
  const userPrompt = 'change the selected thing'
  const mockedGetSelectionReferences = vi.mocked(getSelectionReferences)
  const zookeeperArtifactPromptHandlersByType: Record<
    Artifact['type'],
    ArtifactSelectionPromptHandler
  > = zookeeperArtifactSelectionPromptHandlers
  const zookeeperArtifactTypes = Object.keys(
    zookeeperArtifactPromptHandlersByType
  ) as Artifact['type'][]
  type SelectionReferenceDependencies = {
    kclManager: KclManager
    engineCommandManager: ConnectionManager
    wasmInstance: ModuleType
  }
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
    selectionReferenceDependencies = unusedSelectionReferenceDependencies,
  }: {
    code: string
    selections: Selections | null
    artifactGraph?: ArtifactGraph
    selectionReferenceDependencies?: SelectionReferenceDependencies
  }) =>
    constructZookeeperUserPromptRequest({
      prompt: userPrompt,
      selections,
      projectFiles: makeProjectFiles(code),
      applicationProjectDirectory: '/projects',
      artifactGraph,
      projectName: 'zoo-project',
      currentFile: { entry: currentFileEntry, content: code },
      kclVersion: '1.0.0',
      ...selectionReferenceDependencies,
    })

  beforeEach(() => {
    mockedGetSelectionReferences.mockReset()
    mockedGetSelectionReferences.mockResolvedValue([])
  })

  it('omits source ranges when selection data is unavailable', async () => {
    const code = 'width = 5\n'
    const request = await makeRequest({ code, selections: null })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(request.activeFile).toBe('main.kcl')
    expect(request.body.prompt).toBe(userPrompt)
    expect(request.body).not.toHaveProperty('source_ranges')
  })

  it('returns a forward-slash active file for nested files', async () => {
    const request = await constructZookeeperUserPromptRequest({
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

  it('sends an empty source range list for known-empty selection data', async () => {
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
    expect(request.body.source_ranges).toStrictEqual([])
  })

  it('has an explicit handler for every generated artifact type', () => {
    // Assigning the handler map to this typed Record fails compilation when
    // generated KCL artifact types are added without Zookeeper handlers.
    expect(Object.keys(zookeeperArtifactPromptHandlersByType).length).toBe(
      Object.keys(zookeeperArtifactSelectionPromptHandlers).length
    )
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

  it('adds generated graph selection references without changing visible prompt', async () => {
    mockedGetSelectionReferences.mockResolvedValue([
      {
        id: 'face:cubeRegion.tags.right',
        label: 'Face',
        code: 'cubeRegion.tags.right',
      },
    ])

    const code = 'cube = extrude(profile, length = 10)\n'
    const graphSelection = {
      artifact: {
        type: 'wall',
        id: 'cube-wall-right',
        sweepId: 'cube-sweep',
      } as Artifact,
      codeRef: {
        range: [0, 4, 0] as [number, number, number],
        pathToNode: [],
      },
    }
    const request = await makeRequest({
      code,
      artifactGraph: new Map(),
      selections: {
        otherSelections: [],
        graphSelections: [graphSelection],
      },
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(mockedGetSelectionReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        graphSelections: [graphSelection],
        enginePrimitives: [],
      })
    )
    expect(request.body.prompt).toBe(userPrompt)
    expect(request.body.source_ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'main.kcl',
          prompt: expect.stringContaining('Face: `cubeRegion.tags.right`'),
          range: {
            start: { line: 1, column: 0 },
            end: { line: 2, column: 0 },
          },
        }),
      ])
    )
    expect(
      request.body.source_ranges?.some(({ prompt }) =>
        prompt.includes(userPrompt)
      )
    ).toBe(false)
  })

  it('uses project file metadata as the generated reference prompt carrier', async () => {
    mockedGetSelectionReferences.mockResolvedValue([
      {
        id: 'face:cubeRegion.tags.right',
        label: 'Face',
        code: 'cubeRegion.tags.right',
      },
    ])

    const code = 'cube = extrude(profile, length = 10)\n'
    const request = await constructZookeeperUserPromptRequest({
      prompt: userPrompt,
      selections: {
        otherSelections: [],
        graphSelections: [
          {
            artifact: {
              type: 'wall',
              id: 'cube-wall-right',
              sweepId: 'cube-sweep',
            } as Artifact,
            codeRef: {
              range: [0, 4, 0],
              pathToNode: [],
            },
          },
        ],
      },
      projectFiles: [
        {
          type: 'kcl',
          relPath: 'parts/main.kcl',
          absPath: '/projects/zoo-project/parts/main.kcl',
          fileContents: code,
          execStateFileNamesIndex: 0,
        },
      ],
      applicationProjectDirectory: '/not-the-project-root',
      artifactGraph: new Map(),
      projectName: 'zoo-project',
      currentFile: {
        entry: {
          path: '/projects/zoo-project/parts/main.kcl',
          name: 'main.kcl',
          children: null,
        },
        content: code,
      },
      kclVersion: '1.0.0',
      ...unusedSelectionReferenceDependencies,
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(request.activeFile).toBe('parts/main.kcl')
    expect(request.body.source_ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'parts/main.kcl',
          prompt: expect.stringContaining('Face: `cubeRegion.tags.right`'),
        }),
      ])
    )
  })

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
