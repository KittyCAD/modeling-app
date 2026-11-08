import { readKclResult } from '@src/lib/kcl/result'
import { expect, it } from 'vitest'

it('collects structured WASM and engine failures as capability errors', () => {
  expect(
    readKclResult({ error: { kind: 'semantic', msg: 'Unknown name' } })
  ).toEqual(new Error('Unknown name'))
  expect(
    readKclResult(JSON.stringify({ error: { message: 'Invalid sketch' } }))
  ).toEqual(new Error('Invalid sketch'))
  expect(
    readKclResult({
      success: false,
      errors: [{ message: 'Engine unavailable' }],
    })
  ).toEqual(new Error('Engine unavailable'))
  expect(readKclResult(new Error('Connection lost'))).toEqual(
    new Error('Connection lost')
  )
  expect(readKclResult('Parse failed')).toEqual(new Error('Parse failed'))
})
it('preserves successful SDK data, including serialized results', () => {
  const result = { exec_outcome: { variables: {} } }
  expect(readKclResult(result)).toEqual({ result })
  expect(readKclResult(JSON.stringify(result))).toEqual({ result })
})
