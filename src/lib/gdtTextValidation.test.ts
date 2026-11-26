import { validateGdtText } from '@src/lib/gdtTextValidation'
import { describe, expect, it } from 'vitest'

describe('GD&T command text', () => {
  it.each([
    'Use "datum A" after polish',
    'C:\\parts',
    'line\nbreak',
    'tab\there',
    'line\rbreak',
  ])('rejects text requiring unsupported KCL escapes: %s', async (data) => {
    expect(await validateGdtText({ data })).toEqual(expect.any(String))
  })

  it.each(['Use datum A after polish', "Use the part's datum", '± 0.1 mm'])(
    'accepts text that can be represented directly: %s',
    async (data) => {
      expect(await validateGdtText({ data })).toBe(true)
    }
  )
})
