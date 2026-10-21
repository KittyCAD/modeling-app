import {
  withAPIBaseURL,
  withKittycadWebSocketURL,
  withSiteBaseURL,
} from '@src/lib/withBaseURL'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('withBaseURL', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ZOO_BASE_DOMAIN', 'example.test')
    vi.stubEnv('VITE_ZOO_API_BASE_URL', undefined)
    vi.stubEnv('VITE_KITTYCAD_WEBSOCKET_URL', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('withAPIBaseURL', () => {
    it('should return base url', () => {
      const expected = 'https://api.example.test'
      const actual = withAPIBaseURL('')
      expect(actual).toBe(expected)
    })
    it('should return base url with /users', () => {
      const expected = 'https://api.example.test/users'
      const actual = withAPIBaseURL('/users')
      expect(actual).toBe(expected)
    })
    it('should return a longer base url with /oauth2/token/revoke', () => {
      const expected = 'https://api.example.test/oauth2/token/revoke'
      const actual = withAPIBaseURL('/oauth2/token/revoke')
      expect(actual).toBe(expected)
    })
    it('should ensure base url does not have ending slash', () => {
      const expected = 'https://api.example.test'
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
      const expected = 'https://example.test'
      const actual = withSiteBaseURL('')
      expect(actual).toBe(expected)
    })
    it('should return base url with /docs', () => {
      const expected = 'https://example.test/docs'
      const actual = withSiteBaseURL('/docs')
      expect(actual).toBe(expected)
    })
    it('should return a longer base base url with /docs/kcl-samples/car-wheel-assembly', () => {
      const expected =
        'https://example.test/docs/kcl-samples/car-wheel-assembly'
      const actual = withSiteBaseURL('/docs/kcl-samples/car-wheel-assembly')
      expect(actual).toBe(expected)
    })
    it('should ensure base url does not have ending slash', () => {
      const expected = 'https://example.test'
      const actual = withSiteBaseURL('')
      expect(actual).toBe(expected)
      const expectedEndsWith = expected[expected.length - 1]
      const actualEndsWith = actual[actual.length - 1]
      expect(actual).toBe(expected)
      expect(actualEndsWith).toBe(expectedEndsWith)
    })
  })

  describe('withKittycadWebSocketURL', () => {
    it('should return url', () => {
      const expected = 'wss://api.example.test/ws/modeling/commands'
      const actual = withKittycadWebSocketURL('')
      expect(actual).toBe(expected)
    })
    it('should return url with /docs', () => {
      const expected = 'wss://api.example.test/ws/modeling/commands?'
      const actual = withKittycadWebSocketURL('?')
      expect(actual).toBe(expected)
    })
    it('should ensure url does not have ending slash', () => {
      const expected = 'wss://api.example.test/ws/modeling/commands'
      const actual = withKittycadWebSocketURL('')
      expect(actual).toBe(expected)
      const expectedEndsWith = expected[expected.length - 1]
      const actualEndsWith = actual[actual.length - 1]
      expect(actual).toBe(expected)
      expect(actualEndsWith).toBe(expectedEndsWith)
    })
  })
})
