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
    const wallArtifact = {
      type: 'wall',
      id: 'cube-wall-right',
      segId: 'cube-segment-right',
      edgeCutEdgeIds: [],
      sweepId: 'cube-sweep',
      pathIds: [],
      faceCodeRef: {
        range: [0, 4, 0],
        nodePath: { steps: [] },
        pathToNode: [],
      },
      cmdId: 'cube-wall-command',
    } satisfies Extract<Artifact, { type: 'wall' }>
    const graphSelection = {
      artifact: wallArtifact,
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

  it('describes a Face API edge using its face artifacts', async () => {
    const code = `profile = sketch(on = XY) {
  right = line(end = [10, 0])
}
region001 = region(point = [5, 1], sketch = profile)
body = extrude(region001, length = 10, tagEnd = $endCap)
`
    const segmentRange = [
      code.indexOf('right = line'),
      code.indexOf('right = line') + 'right = line(end = [10, 0])'.length,
      0,
    ] as [number, number, number]
    const extrudeRange = [
      code.indexOf('extrude('),
      code.indexOf('extrude(') +
        'extrude(region001, length = 10, tagEnd = $endCap)'.length,
      0,
    ] as [number, number, number]
    const regionRange = [
      code.indexOf('region('),
      code.indexOf('region(') +
        'region(point = [5, 1], sketch = profile)'.length,
      0,
    ] as [number, number, number]
    const wall = {
      type: 'wall',
      id: 'wall-right',
      sweepId: 'body-sweep',
      segId: 'region-right-segment',
      edgeCutEdgeIds: [],
      pathIds: [],
      faceCodeRef: {
        range: extrudeRange,
        nodePath: { steps: [] },
        pathToNode: [],
      },
      cmdId: 'wall-command',
    } satisfies Extract<Artifact, { type: 'wall' }>
    const cap = {
      type: 'cap',
      id: 'end-cap',
      sweepId: 'body-sweep',
      subType: 'end',
      edgeCutEdgeIds: [],
      pathIds: [],
      faceCodeRef: {
        range: extrudeRange,
        nodePath: { steps: [] },
        pathToNode: [],
      },
      cmdId: 'cap-command',
    } satisfies Extract<Artifact, { type: 'cap' }>
    const sourceSegment = {
      type: 'segment',
      id: 'right-segment',
      pathId: 'profile-path',
      edgeIds: [],
      codeRef: {
        range: segmentRange,
        nodePath: { steps: [] },
        pathToNode: [],
      },
      commonSurfaceIds: [],
    } satisfies Extract<Artifact, { type: 'segment' }>
    const regionSegment = {
      type: 'segment',
      id: 'region-right-segment',
      pathId: 'body-path',
      originalSegId: sourceSegment.id,
      edgeIds: [],
      codeRef: { range: regionRange, nodePath: { steps: [] }, pathToNode: [] },
      commonSurfaceIds: [],
    } satisfies Extract<Artifact, { type: 'segment' }>
    const bodyPath = {
      type: 'path',
      id: 'body-path',
      subType: 'region',
      planeId: 'xy-plane',
      segIds: [regionSegment.id],
      consumed: false,
      sweepId: 'body-sweep',
      trajectorySweepId: null,
      codeRef: { range: regionRange, nodePath: { steps: [] }, pathToNode: [] },
    } satisfies Extract<Artifact, { type: 'path' }>
    const bodySweep = {
      type: 'sweep',
      id: 'body-sweep',
      subType: 'extrusion',
      pathId: bodyPath.id,
      surfaceIds: [wall.id, cap.id],
      edgeIds: [],
      codeRef: {
        range: extrudeRange,
        nodePath: { steps: [] },
        pathToNode: [],
      },
      trajectoryId: null,
      method: 'new',
      consumed: false,
    } satisfies Extract<Artifact, { type: 'sweep' }>
    const artifactGraph = new Map<string, Artifact>([
      [sourceSegment.id, sourceSegment],
      [regionSegment.id, regionSegment],
      [bodyPath.id, bodyPath],
      [bodySweep.id, bodySweep],
      [wall.id, wall],
      [cap.id, cap],
    ])
    const graphSelection = {
      entityRef: {
        type: 'edge' as const,
        side_faces: [wall.id, cap.id],
        end_faces: [wall.id],
        index: 2,
      },
    }

    const request = await makeRequest({
      code,
      artifactGraph,
      selections: {
        otherSelections: [],
        graphSelections: [graphSelection],
      },
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return

    expect(mockedGetSelectionReferences).toHaveBeenCalledWith(
      expect.objectContaining({ graphSelections: [] })
    )
    expect(request.body.source_ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prompt: expect.stringContaining(
            'The selected wall originates from this specific sketch segment'
          ),
        }),
        expect.objectContaining({
          prompt: expect.stringContaining(
            'The selected wall belongs to the sweep created by this operation'
          ),
        }),
        expect.objectContaining({
          prompt: expect.stringContaining(
            'This region supplies the profile swept by that operation'
          ),
        }),
        expect.objectContaining({
          prompt: expect.stringContaining(
            'Face selection group sideFaces[1]: end cap face (step 1 of 2)'
          ),
        }),
        expect.objectContaining({
          prompt: expect.stringContaining(
            'Add or use `tagEnd` on this operation'
          ),
        }),
        expect.objectContaining({
          prompt: expect.stringContaining(
            'The user selected an edge using the Face API'
          ),
        }),
      ])
    )
    const entityPrompt = request.body.source_ranges?.find(({ prompt }) =>
      prompt.includes('The user selected an edge using the Face API')
    )?.prompt
    expect(entityPrompt).toContain('sideFaces:')
    expect(entityPrompt).toContain('endFaces:')
    expect(entityPrompt).toContain('index: 2')
    expect(entityPrompt).toContain(
      'wall artifact produced from a swept sketch segment'
    )
    expect(entityPrompt).toContain('end cap artifact produced by a sweep')
    expect(entityPrompt).toContain(
      'This is the complete Face API reference returned for the selected edge'
    )
    expect(entityPrompt).toContain(
      'Fields not shown are not part of this reference'
    )
    expect(entityPrompt).not.toContain('getCommonEdge')
    expect(entityPrompt).not.toContain(wall.id)
    expect(entityPrompt).not.toContain(cap.id)

    const minimalRequest = await makeRequest({
      code,
      artifactGraph,
      selections: {
        otherSelections: [],
        graphSelections: [
          {
            entityRef: {
              type: 'edge' as const,
              side_faces: [wall.id, cap.id],
            },
          },
        ],
      },
    })

    expect(isErr(minimalRequest)).toBe(false)
    if (isErr(minimalRequest)) return
    const minimalEntityPrompt = minimalRequest.body.source_ranges?.find(
      ({ prompt }) =>
        prompt.includes('The user selected an edge using the Face API')
    )?.prompt
    expect(minimalEntityPrompt).not.toContain('\n  endFaces:')
    expect(minimalEntityPrompt).not.toContain('\n  index:')
  })

  it('describes an edge-treatment face as the result of its operation', async () => {
    const code = `chamfer001 = chamfer(
  body001,
  edges = [{ sideFaces = [right, bottom] }],
  length = 4,
  tag = $chamferFace,
)
`
    const edgeCut = {
      type: 'edgeCut',
      id: 'chamfer-face',
      subType: 'chamfer',
      edgeIds: [],
      codeRef: {
        range: [0, code.length - 1, 0],
        nodePath: { steps: [] },
        pathToNode: [],
      },
    } satisfies Extract<Artifact, { type: 'edgeCut' }>
    const request = await makeRequest({
      code,
      artifactGraph: new Map([[edgeCut.id, edgeCut]]),
      selections: {
        otherSelections: [],
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: [edgeCut.id],
            },
          },
        ],
      },
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return
    const edgeCutPrompt = request.body.source_ranges?.find(({ prompt }) =>
      prompt.includes('edge-treatment operation created the selected face')
    )?.prompt
    expect(edgeCutPrompt).toContain(
      'the user selected the generated face, not the chamfer or fillet operation itself'
    )
    expect(edgeCutPrompt).toContain('Preserve the existing operation')
    expect(edgeCutPrompt).toContain(
      'Its `tag` argument, when present, names this generated face'
    )
  })

  it('keeps non-topology entity references in generated selection references', async () => {
    mockedGetSelectionReferences.mockResolvedValue([
      {
        id: 'helix:helix001',
        label: 'Helix',
        code: 'helix001',
      },
    ])
    const code = 'helix001 = helix(axis = Z, revolutions = 3)\n'
    const helixArtifact = {
      type: 'helix',
      id: 'helix-id',
      axisId: null,
      codeRef: {
        range: [0, code.length - 1, 0],
        nodePath: { steps: [] },
        pathToNode: [],
      },
      trajectorySweepId: null,
      consumed: false,
    } satisfies Extract<Artifact, { type: 'helix' }>
    const graphSelection = {
      entityRef: {
        type: 'helix' as const,
        helix_id: 'helix-id',
      },
      artifact: helixArtifact,
      codeRef: {
        range: [0, code.length - 1, 0] as [number, number, number],
        pathToNode: [],
      },
    }

    const request = await makeRequest({
      code,
      selections: {
        otherSelections: [],
        graphSelections: [graphSelection],
      },
    })

    expect(isErr(request)).toBe(false)
    if (isErr(request)) return
    expect(mockedGetSelectionReferences).toHaveBeenCalledWith(
      expect.objectContaining({ graphSelections: [graphSelection] })
    )
    expect(request.body.source_ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prompt: expect.stringContaining('Helix: `helix001`'),
        }),
      ])
    )
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

  it('reports and omits graph selections when their source file cannot be mapped', async () => {
    const code = 'width = 5\n'
    const reportSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const request = await constructZookeeperUserPromptRequest({
        prompt: userPrompt,
        selections: {
          otherSelections: [],
          graphSelections: [
            {
              codeRef: {
                range: [0, 5, 0],
                pathToNode: [],
              },
            },
          ],
        },
        projectFiles: [
          {
            type: 'kcl',
            relPath: 'main.kcl',
            absPath: '/projects/zoo-project/main.kcl',
            fileContents: code,
            execStateFileNamesIndex: undefined as unknown as number,
          },
        ],
        applicationProjectDirectory: '/projects',
        artifactGraph: new Map(),
        projectName: 'zoo-project',
        currentFile: { entry: currentFileEntry, content: code },
        kclVersion: '1.0.0',
        ...unusedSelectionReferenceDependencies,
      })

      expect(isErr(request)).toBe(false)
      if (isErr(request)) return

      expect(request.activeFile).toBe('main.kcl')
      expect(request.body.prompt).toBe(userPrompt)
      expect(request.body.source_ranges).toStrictEqual([])
      expect(reportSpy).toHaveBeenCalledWith(
        expect.stringContaining('no KCL file found')
      )
    } finally {
      reportSpy.mockRestore()
    }
  })
})
