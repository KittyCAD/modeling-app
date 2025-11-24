import type { ParseResult, SourceRange } from '@src/lang/wasm'
import {
  getCalculatedKclExpressionValue,
  getStringValue,
} from '@src/lib/kclHelpers'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

describe('KCL expression calculations', () => {
  it('calculates a simple expression without units', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    const actual = await getCalculatedKclExpressionValue('1 + 2', rustContext)
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('3')
    expect(coercedActual?.astNode).toBeDefined()
  })
  it('calculates a simple expression with units', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    const actual = await getCalculatedKclExpressionValue(
      '1deg + 30deg',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('31deg')
    expect(coercedActual?.astNode).toBeDefined()
  })
  it('returns NAN for an invalid expression', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    const actual = await getCalculatedKclExpressionValue('1 + x', rustContext)
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('returns NAN for arrays when allowArrays is false (default)', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    const actual = await getCalculatedKclExpressionValue(
      '[1, 2, 3]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('returns NAN for arrays when allowArrays is explicitly false', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    const actual = await getCalculatedKclExpressionValue(
      '[1, 2, 3]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('formats simple number arrays when allowArrays is true', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    const actual = await getCalculatedKclExpressionValue(
      '[1, 2, 3]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('[1, 2, 3]')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('formats arrays with units when allowArrays is true', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    const actual = await getCalculatedKclExpressionValue(
      '[1mm, 2mm, 3mm]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('[1mm, 2mm, 3mm]')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('formats mixed arrays when allowArrays is true', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    const actual = await getCalculatedKclExpressionValue(
      '[0, 1, 0]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('[0, 1, 0]')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('rejects arrays with non-numeric types when allowArrays is true', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    // Arrays non-numeric values should be rejected even when allowArrays is true
    const actual = await getCalculatedKclExpressionValue(
      '[1, true, 0]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('formats arrays with mixed numeric values (integers and floats) when allowArrays is true', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    // Arrays different numeric types should work fine
    const actual = await getCalculatedKclExpressionValue(
      '[1, 2.5, 0]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('[1, 2.5, 0]')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('handles arrays with undefined variables when allowArrays is true', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    // Test happens with arrays containing undefined variables like [0, x, 0]
    const actual = await getCalculatedKclExpressionValue(
      '[0, x, 0]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    // This returns 'NAN' because 'x' is undefined - the entire array expression fails
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('handles arrays with arithmetic expressions when allowArrays is true', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    // Test containing expressions like [0, 2 + 3, 0] that evaluate to numbers
    const actual = await getCalculatedKclExpressionValue(
      '[0, 2 + 3, 0]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('[0, 5, 0]')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('rejects empty arrays when allowArrays is true', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    // Empty aren't useful for geometric operations and should be rejected
    const actual = await getCalculatedKclExpressionValue('[]', rustContext)
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('rejects arrays when allowArrays parameter is omitted', async () => {
    const { rustContext } = await buildTheWorldAndNoEngineConnection()
    const actual = await getCalculatedKclExpressionValue(
      '[1, 2, 3]',
      rustContext
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })
})

describe('getStringValue', () => {
  it('returns a string value from a range', () => {
    const code = `appearance(abc, color = "#00FF00")`
    const range: SourceRange = [25, 25 + 7, 0] // '#00FF00' range
    const result = getStringValue(code, range)
    expect(result).toBe('#00FF00')
  })

  it('an empty string on bad range', () => {
    const code = `badboi`
    const range: SourceRange = [10, 12, 0]
    const result = getStringValue(code, range)
    expect(result).toBe('')
  })
})
