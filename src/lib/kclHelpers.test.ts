import { ParseResult } from 'lang/wasm'

import { getCalculatedKclExpressionValue } from './kclHelpers'

describe('KCL expression calculations', () => {
  it('calculates a simple expression', async () => {
    const actual = await getCalculatedKclExpressionValue('1 + 2')
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('3')
    expect(coercedActual?.astNode).toBeDefined()
  })
  it('returns NAN for an invalid expression', async () => {
    const actual = await getCalculatedKclExpressionValue('1 + x')
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })
})
