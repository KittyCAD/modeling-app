import { beforeAll, describe, it, expect, vi, beforeEach } from 'vitest'
import { exportSketchToDxf } from '@src/lib/exportDxf'
import type { StdLibCallOp } from '@src/lang/queryAst'
import { err } from '@src/lib/trap'
import type { WebSocketResponse } from '@kittycad/lib'
import type { Artifact } from '@src/lang/std/artifactGraph'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

const { mockElectron } = vi.hoisted(() => {
  // Mock window.electron for desktop environment tests
  const mockElectron = {
    writeFile: vi.fn(),
    readdir: vi.fn(),
    access: vi.fn(),
    getPath: vi.fn(),
    cp: vi.fn(),
    rm: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    path: {
      join: vi.fn(),
      resolve: vi.fn(),
      relative: vi.fn(),
      extname: vi.fn(),
      sep: '/',
      basename: vi.fn(),
      dirname: vi.fn(),
    },
    stat: vi.fn(),
    statIsDirectory: vi.fn(),
    exists: vi.fn(),
    readFile: vi.fn(),
    platform: 'linux',
    save: vi.fn(),
    os: {
      isMac: false,
      isWindows: false,
      isLinux: true,
    },
    process: {
      env: {
        NODE_ENV: 'development',
      },
    },
    getAppTestProperty: vi.fn(),
    packageJson: {
      name: '',
    },
  }

  // Setup global window.electron mock
  vi.stubGlobal('window', {
    electron: mockElectron,
    localStorage: {
      getItem: (key: string) => undefined,
    },
  })

  return { mockElectron }
})

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.ElectronFS,
    options: {},
  })
})

// Mock dependencies
const createMockDependencies = (): Parameters<typeof exportSketchToDxf>[1] => ({
  engineCommandManager: {
    sendSceneCommand: vi.fn(),
    engineConnection: undefined,
    pendingCommands: {},
    sendCommand: vi.fn(),
    waitForAllCommands: vi.fn().mockResolvedValue([]),
    rejectAllModelingCommands: vi.fn(),
    tearDown: vi.fn(),
  } as any,
  kclManager: {
    artifactGraph: new Map(),
    ast: {
      body: [],
      start: 0,
      end: 0,
      moduleId: 'test-module',
    },
    wasmInstancePromise: vi.importActual('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'),
  } as any,
  toast: {
    error: vi.fn(),
    loading: vi.fn().mockReturnValue('toast-id'),
    success: vi.fn(),
    dismiss: vi.fn(),
  },
  uuidv4: vi.fn().mockReturnValue('test-uuid'),
  base64Decode: vi.fn(),
  browserSaveFile: vi.fn(),
})

const createMockOperation = (): StdLibCallOp => ({
  type: 'StdLibCall',
  name: 'startSketchOn',
  unlabeledArg: null,
  labeledArgs: {},
  nodePath: {
    steps: [
      { type: 'ProgramBodyItem', index: 0 },
      { type: 'ExpressionStatementExpr' },
      { type: 'CallCallee' },
    ],
  },
  sourceRange: [0, 0, 0],
})

describe('DXF Export', () => {
  let mockDeps: Parameters<typeof exportSketchToDxf>[1]
  let mockOperation: StdLibCallOp

  beforeEach(() => {
    mockDeps = createMockDependencies()
    mockOperation = createMockOperation()
    vi.clearAllMocks()

    // Reset electron mock
    vi.mocked(mockElectron.getAppTestProperty).mockReset()
    vi.mocked(mockElectron.path.join).mockReset()
    vi.mocked(mockElectron.mkdir).mockReset()
  })

  describe('exportSketchToDxf', () => {
    it('should successfully export DXF in browser environment', async () => {
      // Setup: valid plane artifact with pathIds
      const planeArtifact: Artifact = {
        id: 'plane-id',
        type: 'plane',
        pathIds: ['path-1', 'path-2'],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
      }
      const pathArtifact1: Artifact = {
        id: 'path-1',
        type: 'path',
        planeId: 'plane-id',
        segIds: [],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
        trajectorySweepId: null,
        consumed: false,
      }
      const pathArtifact2: Artifact = {
        id: 'path-2',
        type: 'path',
        planeId: 'plane-id',
        segIds: [],
        compositeSolidId: 'solid-1',
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
        trajectorySweepId: null,
        consumed: false,
      }

      mockDeps.kclManager.artifactGraph.set('plane-id', planeArtifact)
      mockDeps.kclManager.artifactGraph.set('path-1', pathArtifact1)
      mockDeps.kclManager.artifactGraph.set('path-2', pathArtifact2)

      // Mock successful engine response
      const mockResponse: WebSocketResponse = {
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'export2d',
              data: {
                files: [{ contents: 'base64-content', name: 'sketch.dxf' }],
              },
            },
          },
        },
      }
      vi.mocked(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        mockDeps.engineCommandManager.sendSceneCommand
      ).mockResolvedValue(mockResponse)

      // Mock successful base64 decode
      const mockDecodedData = new ArrayBuffer(8)
      vi.mocked(mockDeps.base64Decode).mockImplementation((input: string) => {
        if (!input) return new Error('Invalid base64 input')
        return mockDecodedData
      })

      vi.mocked(mockDeps.browserSaveFile).mockResolvedValue(undefined)
      mockElectron.save.mockResolvedValue({
        canceled: false,
        filePath: '/path/to/sketch.dxf',
      })

      const result = await exportSketchToDxf(mockOperation, mockDeps)

      expect(result).toBe(true)
      expect(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        mockDeps.engineCommandManager.sendSceneCommand
      ).toHaveBeenCalledWith(
        {
          type: 'modeling_cmd_req',
          cmd_id: 'test-uuid',
          cmd: {
            type: 'export2d',
            entity_ids: ['path-1', 'solid-1'],
            format: {
              type: 'dxf',
              storage: 'ascii',
            },
          },
        },
        true
      )
      expect(mockElectron.save).toHaveBeenCalledWith({
        defaultPath: 'sketch.dxf',
        filters: [
          {
            extensions: ['dxf'],
            name: 'DXF files',
          },
        ],
      })
    })

    it('should successfully export DXF in desktop environment', async () => {
      // Setup: valid plane artifact with pathIds
      const planeArtifact: Artifact = {
        id: 'plane-id',
        type: 'plane',
        pathIds: ['path-1'],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
      }
      const pathArtifact: Artifact = {
        id: 'path-1',
        type: 'path',
        planeId: 'plane-id',
        segIds: [],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
        trajectorySweepId: null,
        consumed: false,
      }

      mockDeps.kclManager.artifactGraph.set('plane-id', planeArtifact)
      mockDeps.kclManager.artifactGraph.set('path-1', pathArtifact)

      // Mock successful engine response
      const mockResponse: WebSocketResponse = {
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'export2d',
              data: {
                files: [{ contents: 'base64-content', name: 'sketch.dxf' }],
              },
            },
          },
        },
      }
      vi.mocked(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        mockDeps.engineCommandManager.sendSceneCommand
      ).mockResolvedValue(mockResponse)

      // Mock successful base64 decode
      const mockDecodedData = new ArrayBuffer(8)
      vi.mocked(mockDeps.base64Decode).mockImplementation((input: string) => {
        if (!input) return new Error('Invalid base64 input')
        return mockDecodedData
      })

      mockElectron.save.mockResolvedValue({
        canceled: false,
        filePath: '/path/to/sketch.dxf',
      })
      mockElectron.writeFile.mockResolvedValue(undefined)

      const result = await exportSketchToDxf(mockOperation, mockDeps)

      expect(result).toBe(true)

      expect(mockElectron.save).toHaveBeenCalledWith({
        defaultPath: 'sketch.dxf',
        filters: [
          {
            name: 'DXF files',
            extensions: ['dxf'],
          },
        ],
      })
      expect(mockElectron.writeFile).toHaveBeenCalledWith(
        '/path/to/sketch.dxf',
        expect.any(Uint8Array)
      )
      expect(mockDeps.toast.success).toHaveBeenCalledWith(
        'DXF export completed',
        { id: 'toast-id' }
      )
    })

    it('should return error when plane artifact is not found', async () => {
      // Setup: empty artifact graph
      mockDeps.kclManager.artifactGraph.clear()

      const result = await exportSketchToDxf(mockOperation, mockDeps)

      expect(err(result)).toBe(true)
      if (err(result)) {
        expect(result.message).toBe('Could not find plane artifact')
      }
      expect(mockDeps.toast.error).toHaveBeenCalledWith(
        'Could not find sketch for DXF export'
      )
    })

    it('should return error when plane artifact with empty pathIds', async () => {
      // Test case 1: plane artifact without pathIds
      const planeArtifactNoPathIds: Artifact = {
        id: 'plane-id',
        type: 'plane',
        pathIds: [],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
      }
      mockDeps.kclManager.artifactGraph.set('plane-id', planeArtifactNoPathIds)

      let result = await exportSketchToDxf(mockOperation, mockDeps)

      expect(err(result)).toBe(true)
      if (err(result)) {
        expect(result.message).toBe('Could not find path IDs')
      }
      expect(mockDeps.toast.error).toHaveBeenCalledWith(
        'Could not find sketch profiles for DXF export'
      )

      // Test case 2: plane artifact with pathIds but no path artifacts in graph
      vi.clearAllMocks()
      mockDeps.kclManager.artifactGraph.clear()

      const planeArtifactEmptyPaths: Artifact = {
        id: 'plane-id',
        type: 'plane',
        pathIds: ['path-1'],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
      }
      mockDeps.kclManager.artifactGraph.set('plane-id', planeArtifactEmptyPaths)

      result = await exportSketchToDxf(mockOperation, mockDeps)

      expect(err(result)).toBe(true)
      if (err(result)) {
        expect(result.message).toBe('Could not find sketch entities')
      }
      expect(mockDeps.toast.error).toHaveBeenCalledWith(
        'Could not find sketch entities for DXF export'
      )
    })

    it('should handle engine command failures and errors', async () => {
      // Setup: valid plane artifact
      const planeArtifact: Artifact = {
        id: 'plane-id',
        type: 'plane',
        pathIds: ['path-1'],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
      }
      const pathArtifact: Artifact = {
        id: 'path-1',
        type: 'path',
        planeId: 'plane-id',
        segIds: [],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
        trajectorySweepId: null,
        consumed: false,
      }

      mockDeps.kclManager.artifactGraph.set('plane-id', planeArtifact)
      mockDeps.kclManager.artifactGraph.set('path-1', pathArtifact)

      // Test case 1: Engine command failure
      const mockFailedResponse: WebSocketResponse = {
        success: false,
        errors: [{ message: 'Engine error', error_code: 'bad_request' }],
      }
      vi.mocked(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        mockDeps.engineCommandManager.sendSceneCommand
      ).mockResolvedValue(mockFailedResponse)

      let result = await exportSketchToDxf(mockOperation, mockDeps)

      expect(err(result)).toBe(true)
      if (err(result)) {
        expect(result.message).toBe('Engine command failed')
      }
      expect(mockDeps.toast.error).toHaveBeenCalledWith(
        'Failed to export sketch to DXF',
        { id: 'toast-id' }
      )

      // Test case 2: Network/exception error
      vi.clearAllMocks()
      vi.mocked(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        mockDeps.engineCommandManager.sendSceneCommand
      ).mockRejectedValue(new Error('Network error'))

      result = await exportSketchToDxf(mockOperation, mockDeps)

      expect(err(result)).toBe(true)
      if (err(result)) {
        expect(result.message).toBe('Network error')
      }
      expect(mockDeps.toast.error).toHaveBeenCalledWith(
        'Failed to export sketch to DXF',
        { id: 'toast-id' }
      )
    })

    it('should handle user cancellation in desktop environment', async () => {
      // Setup: valid plane artifact
      const planeArtifact: Artifact = {
        id: 'plane-id',
        type: 'plane',
        pathIds: ['path-1'],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
      }
      const pathArtifact: Artifact = {
        id: 'path-1',
        type: 'path',
        planeId: 'plane-id',
        segIds: [],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
        trajectorySweepId: null,
        consumed: false,
      }

      mockDeps.kclManager.artifactGraph.set('plane-id', planeArtifact)
      mockDeps.kclManager.artifactGraph.set('path-1', pathArtifact)

      // Mock successful engine response
      const mockResponse: WebSocketResponse = {
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'export2d',
              data: {
                files: [{ contents: 'base64-content', name: 'sketch.dxf' }],
              },
            },
          },
        },
      }
      vi.mocked(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        mockDeps.engineCommandManager.sendSceneCommand
      ).mockResolvedValue(mockResponse)

      // Mock successful base64 decode
      const mockDecodedData = new ArrayBuffer(8)
      vi.mocked(mockDeps.base64Decode).mockImplementation((input: string) => {
        if (!input) return new Error('Invalid base64 input')
        return mockDecodedData
      })

      mockElectron.save.mockResolvedValue({
        canceled: true,
        filePath: '',
      })

      const result = await exportSketchToDxf(mockOperation, mockDeps)

      expect(err(result)).toBe(true)
      if (err(result)) {
        expect(result.message).toBe('User canceled save')
      }
      expect(mockDeps.toast.dismiss).toHaveBeenCalledWith('toast-id')
      expect(mockElectron.writeFile).not.toHaveBeenCalled()
    })

    it('should prioritize DXF files when multiple files are returned', async () => {
      // Setup: valid plane artifact with pathIds
      const planeArtifact: Artifact = {
        id: 'plane-id',
        type: 'plane',
        pathIds: ['path-1'],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
      }
      const pathArtifact: Artifact = {
        id: 'path-1',
        type: 'path',
        planeId: 'plane-id',
        segIds: [],
        codeRef: {
          nodePath: mockOperation.nodePath,
          range: [0, 0, 0],
          pathToNode: [],
        },
        trajectorySweepId: null,
        consumed: false,
      }

      mockDeps.kclManager.artifactGraph.set('plane-id', planeArtifact)
      mockDeps.kclManager.artifactGraph.set('path-1', pathArtifact)

      // Mock engine response with multiple files - DXF should be prioritized
      const mockResponse: WebSocketResponse = {
        success: true,
        request_id: 'test-request-id',
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'export2d',
              data: {
                files: [
                  { name: 'sketch.txt', contents: 'dGV4dC1jb250ZW50' },
                  { name: 'sketch1.dxf', contents: 'Zmlyc3QtZHhmLWNvbnRlbnQ=' }, // This should be selected (first DXF)
                  { name: 'sketch2.dxf', contents: 'c2Vjb25kLWR4Zi1jb250ZW50' }, // This should NOT be selected
                  { name: 'sketch.svg', contents: 'c3ZnLWNvbnRlbnQ=' },
                ],
              },
            },
          },
        },
      }
      vi.mocked(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        mockDeps.engineCommandManager.sendSceneCommand
      ).mockResolvedValue(mockResponse)

      // Mock successful base64 decode for DXF content
      const mockDecodedData = new ArrayBuffer(8)
      vi.mocked(mockDeps.base64Decode).mockImplementation((input: string) => {
        if (!input) return new Error('Invalid base64 input')
        return mockDecodedData
      })

      vi.mocked(mockDeps.browserSaveFile).mockResolvedValue(undefined)
      mockElectron.save.mockResolvedValue({
        canceled: false,
        filePath: '/path/to/sketch.dxf',
      })

      const result = await exportSketchToDxf(mockOperation, mockDeps)

      expect(result).toBe(true)
      // Our logic correctly selects the first DXF file's content (sketch1.dxf)
      // but the filename comes from the sketch name, not the selected file name
      expect(mockDeps.base64Decode).toHaveBeenCalledWith(
        'Zmlyc3QtZHhmLWNvbnRlbnQ=',
        await mockDeps.kclManager.wasmInstancePromise
      )
      expect(mockElectron.save).toHaveBeenCalledWith({
        defaultPath: 'sketch.dxf',
        filters: [
          {
            extensions: ['dxf'],
            name: 'DXF files',
          },
        ],
      })
    })

    it('should successfully export DXF for subtract2d operation', async () => {
      // Setup: subtract2d operation with deeper nodePath
      const subtract2dOperation: StdLibCallOp = {
        type: 'StdLibCall',
        name: 'subtract2d',
        unlabeledArg: {
          value: {
            type: 'Sketch',
            value: {
              artifactId: 'path-1',
            },
          },
          sourceRange: [0, 0, 0],
        },
        labeledArgs: {
          tool: {
            value: {
              type: 'Sketch',
              value: {
                artifactId: 'path-2',
              },
            },
            sourceRange: [0, 0, 0],
          },
        },
        nodePath: {
          steps: [
            { type: 'ProgramBodyItem', index: 0 },
            { type: 'VariableDeclarationInit' },
            { type: 'PipeBodyItem', index: 1 }, // Deeper in the pipe
            { type: 'CallCallee' },
          ],
        },
        sourceRange: [0, 0, 0],
      }

      // Setup: plane artifact with nodePath unrelated to subtract2d (function-defined sketch)
      const planeArtifact: Artifact = {
        id: 'plane-id',
        type: 'plane',
        pathIds: ['path-1', 'path-2'],
        codeRef: {
          nodePath: {
            steps: [
              { type: 'ProgramBodyItem', index: 0 },
              { type: 'VariableDeclarationInit' },
              { type: 'CallCallee' }, // At pipe root
            ],
          },
          range: [0, 0, 0],
          pathToNode: [],
        },
      }

      // Setup: path artifacts with nodePaths in a function body
      const pathArtifact1: Artifact = {
        id: 'path-1',
        type: 'path',
        planeId: 'plane-id',
        segIds: [],
        consumed: false,
        trajectorySweepId: null,
        codeRef: {
          nodePath: {
            steps: [
              { type: 'ProgramBodyItem', index: 0 },
              { type: 'VariableDeclarationInit' },
              { type: 'PipeBodyItem', index: 0 },
              { type: 'CallCallee' },
            ],
          },
          range: [0, 0, 0],
          pathToNode: [],
        },
      }

      const pathArtifact2: Artifact = {
        id: 'path-2',
        type: 'path',
        planeId: 'plane-id',
        segIds: [],
        consumed: false,
        trajectorySweepId: null,
        codeRef: {
          nodePath: {
            steps: [
              { type: 'ProgramBodyItem', index: 0 },
              { type: 'VariableDeclarationInit' },
              { type: 'PipeBodyItem', index: 1 },
              { type: 'CallCallee' },
            ],
          },
          range: [0, 0, 0],
          pathToNode: [],
        },
      }

      mockDeps.kclManager.artifactGraph.set('plane-id', planeArtifact)
      mockDeps.kclManager.artifactGraph.set('path-1', pathArtifact1)
      mockDeps.kclManager.artifactGraph.set('path-2', pathArtifact2)

      // Mock successful engine response
      const mockResponse: WebSocketResponse = {
        success: true,
        request_id: 'test-request-id',
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'export2d',
              data: {
                files: [{ contents: 'base64-content', name: 'sketch.dxf' }],
              },
            },
          },
        },
      }
      vi.mocked(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        mockDeps.engineCommandManager.sendSceneCommand
      ).mockResolvedValue(mockResponse)

      // Mock successful base64 decode
      const mockDecodedData = new ArrayBuffer(8)
      vi.mocked(mockDeps.base64Decode).mockImplementation((input: string) => {
        if (!input) return new Error('Invalid base64 input')
        return mockDecodedData
      })

      // Mock browser environment - no window.electron
      // @ts-ignore
      globalThis.window.electron = undefined
      vi.mocked(mockDeps.browserSaveFile).mockResolvedValue(undefined)

      const result = await exportSketchToDxf(subtract2dOperation, mockDeps)

      expect(result).toBe(true)
      expect(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        mockDeps.engineCommandManager.sendSceneCommand
      ).toHaveBeenCalledWith(
        {
          type: 'modeling_cmd_req',
          cmd_id: 'test-uuid',
          cmd: {
            type: 'export2d',
            entity_ids: ['path-1', 'path-2'],
            format: {
              type: 'dxf',
              storage: 'ascii',
            },
          },
        },
        true
      )
      expect(mockDeps.browserSaveFile).toHaveBeenCalledWith(
        expect.any(Blob),
        'sketch.dxf',
        'toast-id'
      )
    })
  })
})
