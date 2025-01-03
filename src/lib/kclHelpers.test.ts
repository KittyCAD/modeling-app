import { getCalculatedKclExpressionValue } from './kclHelpers'

describe('KCL expression calculations', () => {
  it('calculates a simple expression', async () => {
    const actual = await getCalculatedKclExpressionValue({
      value: '1 + 2',
      variables: [],
    })
    expect(actual?.valueAsString).toEqual('3')
    expect(actual?.astNode).toBeDefined()
  })
  it('calculates a simple expression with a variable', async () => {
    const actual = await getCalculatedKclExpressionValue({
      value: '1 + x',
      variables: [{ key: 'x', value: 2 }],
    })
    expect(actual?.valueAsString).toEqual('3')
    expect(actual?.astNode).toBeDefined()
  })
  it('returns NAN for an invalid expression', async () => {
    const actual = await getCalculatedKclExpressionValue({
      value: '1 + x',
      variables: [],
    })
    expect(actual?.valueAsString).toEqual('NAN')
    expect(actual?.astNode).toBeDefined()
  })
  it('returns NAN for an expression with an invalid variable', async () => {
    const actual = await getCalculatedKclExpressionValue({
      value: '1 + x',
      variables: [{ key: 'y', value: 2 }],
    })
    expect(actual?.valueAsString).toEqual('NAN')
    expect(actual?.astNode).toBeDefined()
  })
  it('calculates a more complex expression with a variable', async () => {
    const actual = await getCalculatedKclExpressionValue({
      value: '(1 + x * x) * 2',
      variables: [{ key: 'x', value: 2 }],
    })
    expect(actual?.valueAsString).toEqual('10')
    expect(actual?.astNode).toBeDefined()
  })
})
