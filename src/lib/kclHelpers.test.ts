import { ParseResult, VariableMap } from 'lang/wasm'
import { getCalculatedKclExpressionValue } from './kclHelpers'

describe('KCL expression calculations', () => {
  it('calculates a simple expression', async () => {
    const actual = await getCalculatedKclExpressionValue('1 + 2', {})
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('3')
    expect(coercedActual?.astNode).toBeDefined()
  })
  it('calculates a simple expression with a variable', async () => {
    const variables: VariableMap = {}
    variables['x'] = {
      type: 'Number',
      value: 2,
      __meta: [],
    }
    const actual = await getCalculatedKclExpressionValue('1 + x', variables)
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('3')
    expect(coercedActual.astNode).toBeDefined()
  })
  it('returns NAN for an invalid expression', async () => {
    const actual = await getCalculatedKclExpressionValue('1 + x', {})
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })
  it('returns NAN for an expression with an invalid variable', async () => {
    const variables: VariableMap = {}
    variables['y'] = {
      type: 'Number',
      value: 2,
      __meta: [],
    }
    const actual = await getCalculatedKclExpressionValue('1 + x', variables)
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })
  it('calculates a more complex expression with a variable', async () => {
    const variables: VariableMap = {}
    variables['x'] = {
      type: 'Number',
      value: 2,
      __meta: [],
    }
    const actual = await getCalculatedKclExpressionValue(
      '(1 + x * x) * 2',
      variables
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('10')
    expect(coercedActual.astNode).toBeDefined()
  })
})
