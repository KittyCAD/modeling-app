import {
  createCallExpressionStdLibKw,
  createExpressionStatement,
  createIdentifier,
  createLabeledArg,
  createLiteral,
} from '@src/lang/create'
import { assertParse, parse, recast, resultIsOk } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

let instanceInThisFile: ModuleType = null!

beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance } = await buildTheWorldAndNoEngineConnection()
  instanceInThisFile = instance
})

describe('createLiteral recast', () => {
  it('should recast generated string literals with escaped quotes as valid KCL', () => {
    const ast = assertParse('@settings(kclVersion = 2.0)', instanceInThisFile)
    ast.body.push(
      createExpressionStatement(
        createCallExpressionStdLibKw(
          'note',
          null,
          [
            createLabeledArg(
              'note',
              createLiteral('Use "datum A" after polish', instanceInThisFile)
            ),
          ],
          undefined,
          [createIdentifier('gdt')]
        )
      )
    )

    const newCode = recast(ast, instanceInThisFile)
    if (err(newCode)) throw newCode

    expect(newCode).toContain(
      'gdt::note(note = "Use \\"datum A\\" after polish")'
    )

    const reparsed = parse(newCode, instanceInThisFile)
    if (err(reparsed)) throw reparsed
    expect(resultIsOk(reparsed)).toBe(true)
  })
})
