import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'

import type { ParseResult } from '@src/lang/wasm'
import { formatNumber, parse, errFromErrWithOutputs } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'

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
  expect(formatNumber(1, 'None')).toEqual('1')
  expect(formatNumber(1, 'Count')).toEqual('1_')
  expect(formatNumber(1, 'Mm')).toEqual('1mm')
  expect(formatNumber(1, 'Inch')).toEqual('1in')
  expect(formatNumber(0.5, 'Mm')).toEqual('0.5mm')
  expect(formatNumber(-0.5, 'Mm')).toEqual('-0.5mm')
})

describe('test errFromErrWithOutputs', () => {
  it('converts KclErrorWithOutputs to KclError', () => {
    const blob =
      '{"error":{"kind":"internal","sourceRanges":[],"msg":"Cache busted"},"operations":[],"artifactCommands":[],"artifactGraph":{"map":{}},"filenames":{},"sourceFiles":{},"defaultPlanes":null}'
    const error = errFromErrWithOutputs(blob)
    const errorStr = JSON.stringify(error)
    expect(errorStr).toEqual(
      '{"kind":"internal","sourceRange":[0,0,0],"msg":"Cache busted","operations":[],"artifactCommands":[],"artifactGraph":{},"filenames":{},"defaultPlanes":null}'
    )
  })
})
