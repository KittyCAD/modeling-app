import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'

import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { topLevelRange } from '@src/lang/util'
import type {
  ExecCallbacks,
  OperationCallbackArgs,
  OperationsByModule,
  ParseResult,
} from '@src/lang/wasm'
import {
  applyOperationCallbackToOperationsByModule,
  assertParse,
  countOperations,
  defaultNodePath,
  errFromErrWithOutputs,
  formatNumberLiteral,
  parse,
  rustImplPathToNode,
} from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'

import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  importFileExtensions,
  relevantFileExtensions,
} from '@src/lang/wasmUtils'
import {
  isExtensionARelevantExtension,
  isExtensionAnImportExtension,
} from '@src/lib/paths'
import type RustContext from '@src/lib/rustContext'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

function normalizeOperationsByModule(operationsByModule: OperationsByModule) {
  return {
    map: Object.fromEntries(
      Object.entries(operationsByModule.map)
        .filter(([, operations]) => operations.length > 0)
        .map(([moduleId, operations]) => [
          moduleId,
          operations.map((operation) => normalizeOperation(operation)),
        ])
    ),
  }
}

function normalizeOperation(operation: unknown): unknown {
  if (isArray(operation)) {
    return operation.map((item) => normalizeOperation(item))
  }

  if (!operation || typeof operation !== 'object') {
    return operation
  }

  const normalized = Object.fromEntries(
    Object.entries(operation).map(([key, value]) => {
      if (key === 'nodePath') {
        return [key, { steps: [] }]
      }

      return [key, normalizeOperation(value)]
    })
  )

  return normalized
}

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine({ webrtc: false, geometryOnly: true })
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})

afterAll(() => {
  engineCommandManagerInThisFile.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

it('can execute parsed AST', async () => {
  const code = `x = 1
// A comment.`
  const result = parse(code, instanceInThisFile)
  expect(err(result)).toEqual(false)
  const pResult = result as ParseResult
  expect(pResult.errors.length).toEqual(0)
  expect(pResult.program).not.toEqual(null)
  const execState = await enginelessExecutor(
    pResult.program as Node<Program>,
    rustContextInThisFile
  )
  expect(err(execState)).toEqual(false)
  const x = execState.variables['x']
  expect(x?.type).toBe('Number')
  if (x?.type !== 'Number') {
    throw new Error('Expected KCL value Number')
  }
  expect(x.value).toEqual(1)
})

it('applies operation callbacks to operations-by-module incrementally', () => {
  const operation = {
    type: 'VariableDeclaration',
    name: 'part001',
    value: { type: 'Number', value: 1, ty: { type: 'Unknown' } },
    visibility: 'default',
    nodePath: defaultNodePath(),
    sourceRange: [0, 1, 0] as [number, number, number],
  } as const

  const next = applyOperationCallbackToOperationsByModule({
    operationsByModule: { map: {} },
    callback: {
      moduleId: 7,
      operation,
      index: 0,
    },
  })

  expect(next).toEqual({
    map: {
      7: [operation],
    },
  })
})

it('matches client-built operations map to ExecOutcome.operations', async () => {
  const ast = assertParse(
    'base = 2\nheight = base + 3\narea = base * height\n',
    instanceInThisFile
  )
  const callbackOperations: OperationsByModule = { map: {} }
  const callbacks: ExecCallbacks = {
    onOperation({ moduleId, operation, index }: OperationCallbackArgs) {
      Object.assign(
        callbackOperations,
        applyOperationCallbackToOperationsByModule({
          operationsByModule: callbackOperations,
          callback: { moduleId, operation, index },
        })
      )
    },
  }

  const execState = await rustContextInThisFile.executeMock(
    ast,
    {},
    undefined,
    false,
    callbacks
  )

  expect(countOperations(callbackOperations)).toBeGreaterThan(0)
  expect(normalizeOperationsByModule(callbackOperations)).toEqual(
    normalizeOperationsByModule(execState.operations)
  )
})

it('formats numbers with units', () => {
  expect(formatNumberLiteral(1, 'None', instanceInThisFile)).toEqual('1')
  expect(formatNumberLiteral(1, 'Count', instanceInThisFile)).toEqual('1_')
  expect(formatNumberLiteral(1, 'Mm', instanceInThisFile)).toEqual('1mm')
  expect(formatNumberLiteral(1, 'Inch', instanceInThisFile)).toEqual('1in')
  expect(formatNumberLiteral(0.5, 'Mm', instanceInThisFile)).toEqual('0.5mm')
  expect(formatNumberLiteral(-0.5, 'Mm', instanceInThisFile)).toEqual('-0.5mm')
  expect(formatNumberLiteral(-0.123, 'Mm', instanceInThisFile, 1)).toEqual(
    '-0.1mm'
  )
  expect(formatNumberLiteral(-0.12345, 'Mm', instanceInThisFile, 4)).toEqual(
    '-0.1235mm'
  )
  expect(formatNumberLiteral(1, 'Unknown', instanceInThisFile)).toEqual(
    new Error('Error formatting number literal: value=1, suffix=Unknown')
  )
})

describe('test errFromErrWithOutputs', () => {
  it('converts KclErrorWithOutputs to KclError', () => {
    const blob =
      '{"error":{"kind":"internal","details":{"sourceRanges":[],"backtrace":[],"msg":"Cache busted"}},"nonFatal":[],"variables":{},"operations":[],"artifactCommands":[],"artifactGraph":{"map":{}},"filenames":{},"sourceFiles":{},"defaultPlanes":null,"engineSceneGeneration":2}'
    const error = errFromErrWithOutputs(blob)
    const errorStr = JSON.stringify(error)
    expect(errorStr).toEqual(
      '{"kind":"internal","sourceRange":[0,0,0],"msg":"Cache busted","kclBacktrace":[],"nonFatal":[],"variables":{},"operations":[],"artifactGraph":{},"filenames":{},"defaultPlanes":null,"engineSceneGeneration":2}'
    )
  })
})

it('converts Rust NodePath to PathToNode', async () => {
  // Convenience for making a SourceRange.
  const sr = topLevelRange

  const ast = assertParse(
    `x = 1 + 2
y = foo(center = [3, 4])`,
    instanceInThisFile
  )
  expect(
    await rustImplPathToNode(ast, sr(4, 5), instanceInThisFile)
  ).toStrictEqual(getNodePathFromSourceRange(ast, sr(4, 5)))
  expect(
    await rustImplPathToNode(ast, sr(31, 32), instanceInThisFile)
  ).toStrictEqual(getNodePathFromSourceRange(ast, sr(31, 32)))

  const ast2 = assertParse(
    `a1 = startSketchOn({
  origin = { x = 0, y = 0, z = 0 },
  xAxis = { x = 1, y = 0, z = 0 },
  //            ^
  yAxis = { x = 0, y = 1, z = 0 },
  zAxis = { x = 0, y = 0, z = 1 }
})
`,
    instanceInThisFile
  )
  expect(
    await rustImplPathToNode(ast2, sr(73, 74), instanceInThisFile)
  ).toStrictEqual(getNodePathFromSourceRange(ast2, sr(73, 74)))
})

describe('relevantFileExtensions', () => {
  it('should return all lowercase extensions', () => {
    const extensions = relevantFileExtensions(instanceInThisFile)
    const expected = true
    const actual = extensions.every((extension) => {
      return extension === extension.toLocaleLowerCase()
    })
    expect(actual).toBe(expected)
  })
  describe('check for each known extension', () => {
    it('contains stp', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'stp'
        }
      )
      expect(actual).toBe(expected)
    })
    it('contains fbxb', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'fbxb'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains gltf', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'gltf'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains ply', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'ply'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains step', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'step'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains kcl', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'kcl'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains glb', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'glb'
        }
      )
      expect(actual).toBe(expected)
    })
    it('contains fbx', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'fbx'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains obj', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'obj'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains sldprt', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'sldprt'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains prt', () => {
      const extensions = relevantFileExtensions(instanceInThisFile)
      expect(extensions).toContain('prt')
    })

    it('contains stl', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'stl'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains md', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'md'
        }
      )
      expect(actual).toBe(expected)
    })
  })
})

describe('importFileExtensions', () => {
  it('should return all lowercase extensions', () => {
    const extensions = importFileExtensions(instanceInThisFile)
    const expected = true
    const actual = extensions.every((extension) => {
      return extension === extension.toLocaleLowerCase()
    })
    expect(actual).toBe(expected)
  })

  describe('check for each known extension', () => {
    it.each(['sat', 'sab', 'catpart', 'prt', 'ipt', 'x_t', 'x_b', 'sldprt'])(
      'contains proprietary part extension %s',
      (extension) => {
        expect(importFileExtensions(instanceInThisFile)).toContain(extension)
      }
    )

    it('contains stp', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'stp'
        }
      )
      expect(actual).toBe(expected)
    })
    it('contains fbxb', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'fbxb'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains gltf', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'gltf'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains ply', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'ply'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains step', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'step'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains glb', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'glb'
        }
      )
      expect(actual).toBe(expected)
    })
    it('contains fbx', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'fbx'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains obj', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'obj'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains sldprt', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'sldprt'
        }
      )
      expect(actual).toBe(expected)
    })

    it('contains prt', () => {
      const extensions = importFileExtensions(instanceInThisFile)
      expect(extensions).toContain('prt')
    })

    it('contains stl', () => {
      const expected = true
      const actual = importFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'stl'
        }
      )
      expect(actual).toBe(expected)
    })
  })
})

describe('isExtensionAnImportExtension', () => {
  it('should work for STEP', () => {
    const extensions = importFileExtensions(instanceInThisFile)
    const expected = true
    const actual = isExtensionAnImportExtension('STEP', extensions)
    expect(actual).toBe(expected)
  })
  it('should work for step', () => {
    const extensions = importFileExtensions(instanceInThisFile)
    const expected = true
    const actual = isExtensionAnImportExtension('step', extensions)
    expect(actual).toBe(expected)
  })
  it('should work for StEp', () => {
    const extensions = importFileExtensions(instanceInThisFile)
    const expected = true
    const actual = isExtensionAnImportExtension('StEp', extensions)
    expect(actual).toBe(expected)
  })
  it('should work for steP', () => {
    const extensions = importFileExtensions(instanceInThisFile)
    const expected = true
    const actual = isExtensionAnImportExtension('steP', extensions)
    expect(actual).toBe(expected)
  })

  it.each([
    'bracket.prt',
    'bracket.prt.1',
    'parts/bracket.PRT.23',
    String.raw`parts\bracket.PrT.3`,
  ])('recognizes Creo import path %s', (filePath) => {
    const extensions = importFileExtensions(instanceInThisFile)
    expect(isExtensionAnImportExtension(filePath, extensions)).toBe(true)
  })

  it.each([
    'bracket.prt.0',
    'bracket.prt.01',
    'bracket.prt.-1',
    'bracket.prt.1.bak',
  ])('rejects invalid Creo import path %s', (filePath) => {
    const extensions = importFileExtensions(instanceInThisFile)
    expect(isExtensionAnImportExtension(filePath, extensions)).toBe(false)
  })
})

describe('isExtensionARelevantExtension', () => {
  it('should work for STEP', () => {
    const extensions = relevantFileExtensions(instanceInThisFile)
    const expected = true
    const actual = isExtensionARelevantExtension('STEP', extensions)
    expect(actual).toBe(expected)
  })
  it('should work for step', () => {
    const extensions = relevantFileExtensions(instanceInThisFile)
    const expected = true
    const actual = isExtensionARelevantExtension('step', extensions)
    expect(actual).toBe(expected)
  })
  it('should work for StEp', () => {
    const extensions = relevantFileExtensions(instanceInThisFile)
    const expected = true
    const actual = isExtensionARelevantExtension('StEp', extensions)
    expect(actual).toBe(expected)
  })
  it('should work for steP', () => {
    const extensions = relevantFileExtensions(instanceInThisFile)
    const expected = true
    const actual = isExtensionARelevantExtension('steP', extensions)
    expect(actual).toBe(expected)
  })

  it('recognizes a versioned Creo path', () => {
    const extensions = relevantFileExtensions(instanceInThisFile)
    expect(isExtensionARelevantExtension('bracket.prt.2', extensions)).toBe(
      true
    )
  })
})

describe('Project file lifecycle', () => {
  it('rejects an unregistered execution path without changing the owned scene', async () => {
    const code = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
radiusValue = 10mm
height = 5mm
profile = sketch(on = XY) {
  perimeter = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([perimeter.center, ORIGIN])
  radius(perimeter) == radiusValue
  horizontal([perimeter.center, perimeter.start])
}
body = extrude(region(segments = [profile.perimeter]), length = height)
`
    const file: ApiFile = { id: 0, path: '/cache-owner/main.kcl', text: code }
    const context = rustContextInThisFile
    const manager = engineCommandManagerInThisFile
    await context.sendOpenProject(file.path, [file])
    const ast = assertParse(code, instanceInThisFile)
    const warm = await context.execute(ast, {}, file.path)
    const body = warm.variables.body
    if (body?.type !== 'Solid') throw new Error('Expected the real solid')
    const receipt = async () => {
      const result = await manager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: crypto.randomUUID(),
        cmd: {
          type: 'scene_get_entity_ids',
          filter: ['solid3d'],
          skip: 0,
          take: 100,
        },
      })
      const reply = isArray(result) ? result[0] : result
      if (
        !reply ||
        !reply.success ||
        !('resp' in reply) ||
        reply.resp.type !== 'modeling' ||
        reply.resp.data.modeling_response.type !== 'scene_get_entity_ids'
      )
        throw new Error('Expected real engine solid IDs')
      return {
        bodyIds: reply.resp.data.modeling_response.data.entity_ids
          .flat()
          .sort(),
        defaultPlanes: context.defaultPlanes,
        project: await context.getProjectState(),
        sessionId: manager.engineSessionId,
      }
    }
    const original = await receipt()
    expect(original.bodyIds).toEqual([body.value.id])
    expect(original.defaultPlanes).not.toBeNull()
    manager.clearCommandLogs()
    await expect(
      context.execute(ast, {}, '/cache-owner/unregistered.kcl')
    ).rejects.toThrow('does not match registered active file')
    expect(await receipt()).toEqual(original)
    const retained = await context.execute(ast, {}, file.path)
    expect(retained.engineSceneGeneration).toBe(warm.engineSceneGeneration)
    expect(retained.defaultPlanes).toEqual(warm.defaultPlanes)
    expect(retained.variables.body).toEqual(body)
    expect(await receipt()).toEqual(original)
    const commands = manager.commandLogs.flatMap((log) =>
      log.type === 'receive-reliable' && log.cmd_type ? [log.cmd_type] : []
    )
    expect(commands).not.toContain('set_kcl_version')
    expect(commands).not.toContain('scene_clear_all')
  }, 90_000)

  it('accepts open, update, and get requests', async () => {
    const projectFiles: ApiFile[] = [
      { id: 0, path: 'some/path/main.kcl', text: 'The first file!' },
      { id: 1, path: 'some/path/to-you.kcl', text: 'The second file 🤑' },
      { id: 2, path: 'some/path/home.kcl', text: 'The third file 🐘' },
    ]

    const currentFile = projectFiles[0]
    if (!currentFile) expect.fail('Expected an active project file')
    await rustContextInThisFile.sendOpenProject(currentFile.path, projectFiles)
    expect(await rustContextInThisFile.getProjectState()).toEqual(projectFiles)

    const newText = 'Things sure are changing.'
    await rustContextInThisFile.sendUpdateFile(1, newText)
    expect((await rustContextInThisFile.getProjectState())[1]).toHaveProperty(
      'text',
      newText
    )
    expect(await rustContextInThisFile.getFileState(1)).toHaveProperty(
      'text',
      newText
    )
  })
})
