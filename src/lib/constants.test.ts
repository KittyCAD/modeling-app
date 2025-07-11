import { isEnvironmentName, SUPPORTED_ENVIRONMENTS } from '@src/lib/constants'

describe('src/lib/constants', () => {
  describe('isEnvironmentName', () => {
    it('should detect development', () => {
      const expected = true
      const actual = isEnvironmentName('development')
      expect(actual).toBe(expected)
    })
    it('should detect production', () => {
      const expected = true
      const actual = isEnvironmentName('production')
      expect(actual).toBe(expected)
    })
    it('should fail on a funny string', () => {
      const expected = false
      const actual = isEnvironmentName('dog')
      expect(actual).toBe(expected)
    })
  })

  /** We do not want these to change easily */
  describe('SUPPORTED_ENVIRONMENTS', () => {
    it('should map to the following object to double check the contents', () => {
      const actual = SUPPORTED_ENVIRONMENTS
      const expected = {
        development: {
          API_URL: 'https://api.dev.zoo.dev',
          SITE_URL: 'https://dev.zoo.dev',
          WEBSOCKET_URL: 'wss://api.dev.zoo.dev/ws/modeling/commands',
          name: 'Development',
        },
        production: {
          API_URL: 'https://api.zoo.dev',
          SITE_URL: 'https://zoo.dev',
          WEBSOCKET_URL: 'wss://api.zoo.dev/ws/modeling/commands',
          name: 'Production',
        },
      }
      expect(actual).toStrictEqual(expected)
    })
  })
})
