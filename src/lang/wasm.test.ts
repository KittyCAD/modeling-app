import { err } from 'lib/trap'
import { initPromise, parse, ParseResult } from './wasm'
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
  expect(execState.memory.get('x')?.value).toEqual(1)
})
