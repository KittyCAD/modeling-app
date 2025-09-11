import type { ParseResult, SourceRange } from '@src/lang/wasm'
import {
  getCalculatedKclExpressionValue,
  getStringValue,
} from '@src/lib/kclHelpers'

describe('KCL expression calculations', () => {
  it('calculates a simple expression without units', async () => {
    const actual = await getCalculatedKclExpressionValue('1 + 2')
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('3')
    expect(coercedActual?.astNode).toBeDefined()
  })
  it('calculates a simple expression with units', async () => {
    const actual = await getCalculatedKclExpressionValue('1deg + 30deg')
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('31deg')
    expect(coercedActual?.astNode).toBeDefined()
  })
  it('returns NAN for an invalid expression', async () => {
    const actual = await getCalculatedKclExpressionValue('1 + x')
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('returns NAN for arrays when allowArrays is false (default)', async () => {
    const actual = await getCalculatedKclExpressionValue('[1, 2, 3]')
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('returns NAN for arrays when allowArrays is explicitly false', async () => {
    const actual = await getCalculatedKclExpressionValue('[1, 2, 3]', false)
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual.valueAsString).toEqual('NAN')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('formats simple number arrays when allowArrays is true', async () => {
    const actual = await getCalculatedKclExpressionValue('[1, 2, 3]', true)
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('[1, 2, 3]')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('formats arrays with units when allowArrays is true', async () => {
    const actual = await getCalculatedKclExpressionValue(
      '[1mm, 2mm, 3mm]',
      true
    )
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('[1mm, 2mm, 3mm]')
    expect(coercedActual.astNode).toBeDefined()
  })

  it('formats mixed arrays when allowArrays is true', async () => {
    const actual = await getCalculatedKclExpressionValue('[0, 1, 0]', true)
    const coercedActual = actual as Exclude<typeof actual, Error | ParseResult>
    expect(coercedActual).not.toHaveProperty('errors')
    expect(coercedActual.valueAsString).toEqual('[0, 1, 0]')
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
