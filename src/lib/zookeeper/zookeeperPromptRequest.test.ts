import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import { assertParse, defaultNodePath } from '@src/lang/wasm'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
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
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

let world: Awaited<
  ReturnType<typeof buildTheWorldAndNoEngineConnection>
> | null = null

afterAll(() => {
  if (!world) return

  world.engineCommandManager.tearDown()
  world.commandBarActor.stop()
  world.settingsActor.stop()
})

async function getWorld() {
  if (!world) {
    world = await buildTheWorldAndNoEngineConnection()
  }
  return world
}

describe('constructZookeeperPromptToEditRequest', () => {
  const userPrompt = 'change the selected thing'
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
    constructZookeeperPromptToEditRequest({
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

  function sourceRangeForSnippet(
    code: string,
    snippet: string
  ): [number, number, number] {
    const start = code.indexOf(snippet)
    expect(start).toBeGreaterThanOrEqual(0)
    return [start, start + snippet.length, 0]
  }

  function createPrimitiveEngineConnectionManager({
    parentEntityId,
    primitiveIndex,
    primitiveType,
  }: {
    parentEntityId: string
    primitiveIndex: number
    primitiveType: 'edge' | 'face'
  }) {
    return {
      sendSceneCommand: vi.fn(async ({ cmd }: { cmd: { type: string } }) => {
        if (cmd.type === 'entity_get_primitive_index') {
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'entity_get_primitive_index',
                  data: {
                    entity_type: primitiveType,
                    primitive_index: primitiveIndex,
                  },
                },
              },
            },
          }
        }

        if (cmd.type === 'entity_get_parent_id') {
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'entity_get_parent_id',
                  data: {
                    entity_id: parentEntityId,
                  },
                },
              },
            },
          }
        }

        return Promise.reject(new Error(`Unexpected command ${cmd.type}`))
      }),
    } as unknown as ConnectionManager
  }

  function mockArtifact(value: Record<string, unknown>): Artifact {
    return value as unknown as Artifact
  }

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

  it('includes generated tag references for graph-only wall selections', async () => {
    const { instance, kclManager } = await getWorld()
    const code = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

cubeSketch = sketch(on = XY) {
  right = line(end = [10, 0])
}
cubeRegion = region(segments = [cubeSketch.right])
cube = extrude(cubeRegion, length = 10)
`
    expect(code).not.toContain('cubeRegion.tags.right')

    const ast = assertParse(code, instance)
    kclManager.updateCodeEditor(code, {
      shouldWriteToDisk: false,
      shouldAddToHistory: false,
    })
    kclManager.ast = ast

    const codeRefForSnippet = (snippet: string) => {
      const range = sourceRangeForSnippet(code, snippet)
      return {
        range,
        nodePath: defaultNodePath(),
        pathToNode: getNodePathFromSourceRange(ast, range),
      }
    }

    const originalRightCodeRef = codeRefForSnippet(
      'right = line(end = [10, 0])'
    )
    const regionCodeRef = codeRefForSnippet(
      'cubeRegion = region(segments = [cubeSketch.right])'
    )
    const sweepCodeRef = codeRefForSnippet('extrude(cubeRegion, length = 10)')

    const cubeSweepId = 'cube-sweep'
    const cubeWallRightId = 'cube-wall-right'
    const regionRightSegmentId = 'region-right-segment'
    const originalRightSegment = mockArtifact({
      type: 'segment',
      id: 'original-right-segment',
      codeRef: originalRightCodeRef,
    })
    const regionRightSegment = mockArtifact({
      type: 'segment',
      id: regionRightSegmentId,
      originalSegId: originalRightSegment.id,
      codeRef: regionCodeRef,
    })
    const cubeSweep = mockArtifact({
      type: 'sweep',
      id: cubeSweepId,
      codeRef: sweepCodeRef,
    })
    const cubeWallRight = mockArtifact({
      type: 'wall',
      id: cubeWallRightId,
      sweepId: cubeSweepId,
      segId: regionRightSegment.id,
    })

    const artifactGraph = new Map<string, Artifact>([
      [originalRightSegment.id, originalRightSegment],
      [regionRightSegment.id, regionRightSegment],
      [cubeSweep.id, cubeSweep],
      [cubeWallRight.id, cubeWallRight],
    ])

    const request = await makeRequest({
      code,
      artifactGraph,
      selections: {
        otherSelections: [],
        graphSelections: [
          {
            artifact: cubeWallRight,
            codeRef: regionCodeRef,
          },
        ],
      },
      selectionReferenceDependencies: {
        kclManager,
        wasmInstance: instance,
        engineCommandManager: createPrimitiveEngineConnectionManager({
          parentEntityId: cubeSweep.id,
          primitiveIndex: 2,
          primitiveType: 'face',
        }),
      },
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(request.body.prompt).toBe(userPrompt)
    expect(request.body.source_ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
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
