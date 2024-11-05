import { err } from 'lib/trap'
import { parse } from './wasm'
import { enginelessExecutor } from 'lib/testHelpers'

it('can execute parsed AST', async () => {
  const code = `x = 1
// A comment.`
  const ast = parse(code)
  expect(err(ast)).toEqual(false)
  const execState = await enginelessExecutor(ast)
  expect(err(ast)).toEqual(false)
  expect(execState.memory.get('x')?.value).toEqual(1)
})
