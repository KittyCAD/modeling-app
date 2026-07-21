import { join } from 'node:path'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import {
  createPathToNodeForLastVariable,
  setCallInAst,
} from '@src/lang/modifyAst'
import type { PathToNode } from '@src/lang/wasm'
import { assertParse, recast } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, it } from 'vitest'

describe('setCallInAst pipe edits', () => {
  let wasmInstance: ModuleType

  beforeAll(async () => {
    wasmInstance = await loadAndInitialiseWasmInstance(
      join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    )
  })

  it('preserves an existing unlabeled argument when an edit cannot rebuild it', () => {
    const code = `translated = translate(
  extrude(profileSketch, length = 1mm),
  x = 1mm,
)
`
    const ast = assertParse(code, wasmInstance)
    const call = createCallExpressionStdLibKw('translate', null, [
      createLabeledArg('x', createLiteral(2, wasmInstance, 'Mm')),
    ])
    const pathToEdit = createPathToNodeForLastVariable(ast, false)
    const pathToNode = setCallInAst({
      ast,
      call,
      pathToEdit,
      pathIfNewPipe: pathToEdit,
      wasmInstance,
    })
    if (err(pathToNode)) {
      throw pathToNode
    }

    expect(recast(ast, wasmInstance)).toContain(
      `translated = translate(extrude(profileSketch, length = 1mm), x = 2mm)`
    )
  })

  it('replaces the existing argument when reconstruction succeeds', () => {
    const ast = assertParse(
      `translated = translate(body, x = 1mm)`,
      wasmInstance
    )
    const call = createCallExpressionStdLibKw(
      'translate',
      createLocalName('replacementBody'),
      [createLabeledArg('x', createLiteral(2, wasmInstance, 'Mm'))]
    )
    const pathToNode = setCallInAst({
      ast,
      call,
      pathToEdit: createPathToNodeForLastVariable(ast, false),
      wasmInstance,
    })
    if (err(pathToNode)) {
      throw pathToNode
    }

    expect(recast(ast, wasmInstance)).toBe(
      `translated = translate(replacementBody, x = 2mm)\n`
    )
  })

  it('edits a call in its existing pipe without adding a duplicate call', () => {
    const code = `body = profile
  |> extrude(length = 1mm)
  |> translate(x = 1mm)
`
    const ast = assertParse(code, wasmInstance)
    const pathToEdit: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
      ['body', 'PipeExpression'],
      [2, 'index'],
    ]
    const call = createCallExpressionStdLibKw('translate', null, [
      createLabeledArg('x', createLiteral(2, wasmInstance, 'Mm')),
    ])
    const pathToNode = setCallInAst({
      ast,
      call,
      pathToEdit,
      pathIfNewPipe: pathToEdit.slice(0, -1).concat([[1, 'index']]),
      wasmInstance,
    })
    if (err(pathToNode)) {
      throw pathToNode
    }

    const newCode = recast(ast, wasmInstance)
    if (err(newCode)) {
      throw newCode
    }
    expect(newCode).toBe(`body = profile
  |> extrude(length = 1mm)
  |> translate(x = 2mm)
`)
    expect(newCode.match(/translate/g)).toHaveLength(1)
  })

  it('does not silently keep the old selection when an edit targets another pipe', () => {
    const ast = assertParse(
      `first = translate(body, x = 1mm)\nsecond = profile |> extrude(length = 1mm)`,
      wasmInstance
    )
    const call = createCallExpressionStdLibKw('translate', null, [
      createLabeledArg('x', createLiteral(2, wasmInstance, 'Mm')),
    ])
    const result = setCallInAst({
      ast,
      call,
      pathToEdit: [
        ['body', ''],
        [0, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', 'VariableDeclarator'],
      ],
      pathIfNewPipe: [
        ['body', ''],
        [1, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', 'VariableDeclarator'],
      ],
      wasmInstance,
    })

    expect(result).toEqual(
      new Error(
        'Cannot edit the call in place because its reconstructed input belongs to a different pipe'
      )
    )
    expect(recast(ast, wasmInstance)).toContain(
      'first = translate(body, x = 1mm)'
    )
  })
})
