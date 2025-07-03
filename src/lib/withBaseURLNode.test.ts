import { withSiteBaseURLNode } from '@src/lib/withBaseURLNode'

describe('withBaseURL', () => {
  describe('withSiteBaseURL', () => {
    it('should return base url', () => {
      const expected = 'https://dev.zoo.dev'
      const actual = withSiteBaseURLNode('')
      expect(actual).toBe(expected)
    })
    it('should return base url with /docs', () => {
      const expected = 'https://dev.zoo.dev/docs'
      const actual = withSiteBaseURLNode('/docs')
      expect(actual).toBe(expected)
    })
    it('should return a longer base base url with /docs/kcl-samples/car-wheel-assembly', () => {
      const expected = 'https://dev.zoo.dev/docs/kcl-samples/car-wheel-assembly'
      const actual = withSiteBaseURLNode('/docs/kcl-samples/car-wheel-assembly')
      expect(actual).toBe(expected)
    })
    it('should ensure base url does not have ending slash', () => {
      const expected = 'https://dev.zoo.dev'
      const actual = withSiteBaseURLNode('')
      expect(actual).toBe(expected)
      const expectedEndsWith = expected[expected.length - 1]
      const actualEndsWith = actual[actual.length - 1]
      expect(actual).toBe(expected)
      expect(actualEndsWith).toBe(expectedEndsWith)
    })
  })
})
