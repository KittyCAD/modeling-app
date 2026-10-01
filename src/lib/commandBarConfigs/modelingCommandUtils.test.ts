import { hasCommandArgumentValue } from '@src/lib/commandBarConfigs/modelingCommandUtils'
import { describe, expect, it } from 'vitest'

describe('modeling command values', () => {
  it('treats empty selections as absent without dropping false values', () => {
    const emptySelection = { graphSelections: [], otherSelections: [] }

    expect(hasCommandArgumentValue(undefined)).toBe(false)
    expect(hasCommandArgumentValue(null)).toBe(false)
    expect(hasCommandArgumentValue('')).toBe(false)
    expect(hasCommandArgumentValue([])).toBe(false)
    expect(hasCommandArgumentValue({})).toBe(false)
    expect(hasCommandArgumentValue(emptySelection)).toBe(false)
    expect(hasCommandArgumentValue(false)).toBe(true)
    expect(
      hasCommandArgumentValue({
        valueAst: {},
        valueText: '5',
        valueCalculated: '5',
      })
    ).toBe(true)
    expect(
      hasCommandArgumentValue({
        graphSelections: [{ artifact: undefined }],
        otherSelections: [],
      })
    ).toBe(true)
  })
})
