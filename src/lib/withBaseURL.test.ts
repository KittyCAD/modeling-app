import {
  withAPIBaseURL
} from '@src/lib/withBaseURL'

describe('withBaseURL', () => {
  /**
   * running in the development environment
   * the .env.development should load
   */
  describe('withAPIBaseUrl', () => {
    it('should return base url', () => {
      const expected = 'https://api.dev.zoo.dev'
      const actual = withAPIBaseURL('')
      expect(actual).toBe(expected)
    })
    it('should return base url with /users', () => {
      const expected = 'https://api.dev.zoo.dev/users'
      const actual = withAPIBaseURL('/users')
      expect(actual).toBe(expected)
    })
    it ('should return a longer base url with /oauth2/token/revoke', () => {
      const expected = 'https://api.dev.zoo.dev/oauth2/token/revoke'
      const actual = withAPIBaseURL('/oauth2/token/revoke')
      expect(actual).toBe(expected)
    })
    it('should ensure base url does not have ending slash', () => {
      const expected = 'https://api.dev.zoo.dev'
      const actual = withAPIBaseURL('')
      expect(actual).toBe(expected)
      const expectedEndsWith = expected[expected.length-1]
      const actualEndsWith = actual[actual.length-1]
      expect(actual).toBe(expected)
      expect(actualEndsWith).toBe(expectedEndsWith)
    })
  })
})
