import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'

import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { topLevelRange } from '@src/lang/util'
import type { ParseResult } from '@src/lang/wasm'
import {
  assertParse,
  errFromErrWithOutputs,
  formatNumberLiteral,
  parse,
  rustImplPathToNode,
} from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'

import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import {
  importFileExtensions,
  relevantFileExtensions,
} from '@src/lang/wasmUtils'
import {
  isExtensionAnImportExtension,
  isExtensionARelevantExtension,
} from '@src/lib/paths'
import { afterAll, expect, beforeEach, describe, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

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
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})

afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
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
  expect(execState.variables['x']?.value).toEqual(1)
})

it('formats numbers with units', () => {
  expect(formatNumberLiteral(1, 'None', instanceInThisFile)).toEqual('1')
  expect(formatNumberLiteral(1, 'Count', instanceInThisFile)).toEqual('1_')
  expect(formatNumberLiteral(1, 'Mm', instanceInThisFile)).toEqual('1mm')
  expect(formatNumberLiteral(1, 'Inch', instanceInThisFile)).toEqual('1in')
  expect(formatNumberLiteral(0.5, 'Mm', instanceInThisFile)).toEqual('0.5mm')
  expect(formatNumberLiteral(-0.5, 'Mm', instanceInThisFile)).toEqual('-0.5mm')
  expect(formatNumberLiteral(1, 'Unknown', instanceInThisFile)).toEqual(
    new Error('Error formatting number literal: value=1, suffix=Unknown')
  )
})

describe('test errFromErrWithOutputs', () => {
  it('converts KclErrorWithOutputs to KclError', () => {
    const blob =
      '{"error":{"kind":"internal","details":{"sourceRanges":[],"backtrace":[],"msg":"Cache busted"}},"nonFatal":[],"variables":{},"operations":[],"artifactCommands":[],"artifactGraph":{"map":{}},"filenames":{},"sourceFiles":{},"defaultPlanes":null}'
    const error = errFromErrWithOutputs(blob)
    const errorStr = JSON.stringify(error)
    expect(errorStr).toEqual(
      '{"kind":"internal","sourceRange":[0,0,0],"msg":"Cache busted","kclBacktrace":[],"nonFatal":[],"variables":{},"operations":[],"artifactGraph":{},"filenames":{},"defaultPlanes":null}'
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

    it('contains stl', () => {
      const expected = true
      const actual = relevantFileExtensions(instanceInThisFile).some(
        (extension) => {
          return extension === 'stl'
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
})
