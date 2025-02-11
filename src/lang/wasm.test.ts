import { err } from 'lib/trap'
import { formatNumber, initPromise, parse, ParseResult } from './wasm'
import { enginelessExecutor } from 'lib/testHelpers'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { Program } from '../wasm-lib/kcl/bindings/Program'

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
