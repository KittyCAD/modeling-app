import {
  withAPIBaseURL,
  withSiteBaseURL,
  withKittycadWebSocketURL,
} from '@src/lib/withBaseURL'
import { expect, describe, it } from 'vitest'

describe('withBaseURL', () => {
  /**
   * running in the development environment
   * the .env.development should load
   */
  describe('withAPIBaseURL', () => {
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
    it('should return a longer base url with /oauth2/token/revoke', () => {
      const expected = 'https://api.dev.zoo.dev/oauth2/token/revoke'
      const actual = withAPIBaseURL('/oauth2/token/revoke')
      expect(actual).toBe(expected)
    })
    it('should ensure base url does not have ending slash', () => {
      const expected = 'https://api.dev.zoo.dev'
      const actual = withAPIBaseURL('')
      expect(actual).toBe(expected)
      const expectedEndsWith = expected[expected.length - 1]
      const actualEndsWith = actual[actual.length - 1]
      expect(actual).toBe(expected)
      expect(actualEndsWith).toBe(expectedEndsWith)
    })
  })

  describe('withSiteBaseURL', () => {
    it('should return base url', () => {
      const expected = 'https://dev.zoo.dev'
      const actual = withSiteBaseURL('')
      expect(actual).toBe(expected)
    })
    it('should return base url with /docs', () => {
      const expected = 'https://dev.zoo.dev/docs'
      const actual = withSiteBaseURL('/docs')
      expect(actual).toBe(expected)
    })
    it('should return a longer base base url with /docs/kcl-samples/car-wheel-assembly', () => {
      const expected = 'https://dev.zoo.dev/docs/kcl-samples/car-wheel-assembly'
      const actual = withSiteBaseURL('/docs/kcl-samples/car-wheel-assembly')
      expect(actual).toBe(expected)
    })
    it('should ensure base url does not have ending slash', () => {
      const expected = 'https://dev.zoo.dev'
      const actual = withSiteBaseURL('')
      expect(actual).toBe(expected)
      const expectedEndsWith = expected[expected.length - 1]
      const actualEndsWith = actual[actual.length - 1]
      expect(actual).toBe(expected)
      expect(actualEndsWith).toBe(expectedEndsWith)
    })
  })

  describe('withWebSocketURL', () => {
    it('should return url', () => {
      const expected = 'wss://api.dev.zoo.dev/ws/modeling/commands'
      const actual = withKittycadWebSocketURL('')
      expect(actual).toBe(expected)
    })
    it('should return url with /docs', () => {
      const expected = 'wss://api.dev.zoo.dev/ws/modeling/commands?'
      const actual = withKittycadWebSocketURL('?')
      expect(actual).toBe(expected)
    })
    it('should ensure url does not have ending slash', () => {
      const expected = 'wss://api.dev.zoo.dev/ws/modeling/commands'
      const actual = withKittycadWebSocketURL('')
      expect(actual).toBe(expected)
      const expectedEndsWith = expected[expected.length - 1]
      const actualEndsWith = actual[actual.length - 1]
      expect(actual).toBe(expected)
      expect(actualEndsWith).toBe(expectedEndsWith)
    })
  })
})
