import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'

import type { ParseResult } from '@src/lang/wasm'
import {
  formatNumberLiteral,
  parse,
  errFromErrWithOutputs,
  rustImplPathToNode,
  assertParse,
} from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { topLevelRange } from '@src/lang/util'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'

beforeEach(async () => {
  await initPromise
})

it('can execute parsed AST', async () => {
  const code = `x = 1
// A comment.`
  const result = parse(code)
  expect(err(result)).toEqual(false)
  const pResult = result as ParseResult
  expect(pResult.errors.length).toEqual(0)
  expect(pResult.program).not.toEqual(null)
  const execState = await enginelessExecutor(pResult.program as Node<Program>)
  expect(err(execState)).toEqual(false)
  expect(execState.variables['x']?.value).toEqual(1)
})

it('formats numbers with units', () => {
  expect(formatNumberLiteral(1, 'None')).toEqual('1')
  expect(formatNumberLiteral(1, 'Count')).toEqual('1_')
  expect(formatNumberLiteral(1, 'Mm')).toEqual('1mm')
  expect(formatNumberLiteral(1, 'Inch')).toEqual('1in')
  expect(formatNumberLiteral(0.5, 'Mm')).toEqual('0.5mm')
  expect(formatNumberLiteral(-0.5, 'Mm')).toEqual('-0.5mm')
  expect(formatNumberLiteral(1, 'Unknown')).toEqual(
    new Error('Error formatting number literal: value=1, suffix=Unknown')
  )
})

describe('test errFromErrWithOutputs', () => {
  it('converts KclErrorWithOutputs to KclError', () => {
    const blob =
      '{"error":{"kind":"internal","sourceRanges":[],"msg":"Cache busted"},"backtrace":[],"nonFatal":[],"operations":[],"artifactCommands":[],"artifactGraph":{"map":{}},"filenames":{},"sourceFiles":{},"defaultPlanes":null}'
    const error = errFromErrWithOutputs(blob)
    const errorStr = JSON.stringify(error)
    expect(errorStr).toEqual(
      '{"kind":"internal","sourceRange":[0,0,0],"msg":"Cache busted","backtrace":[],"nonFatal":[],"operations":[],"artifactCommands":[],"artifactGraph":{},"filenames":{},"defaultPlanes":null}'
    )
  })
})

it('converts Rust NodePath to PathToNode', async () => {
  // Convenience for making a SourceRange.
  const sr = topLevelRange

  const ast = assertParse(`x = 1 + 2
y = foo(center = [3, 4])`)
  expect(await rustImplPathToNode(ast, sr(4, 5))).toStrictEqual(
    getNodePathFromSourceRange(ast, sr(4, 5))
  )
  expect(await rustImplPathToNode(ast, sr(31, 32))).toStrictEqual(
    getNodePathFromSourceRange(ast, sr(31, 32))
  )
})
