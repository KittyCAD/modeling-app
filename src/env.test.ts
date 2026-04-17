import env, {
  generateDomainsFromBaseDomain,
  getEnvironmentNameFromEnv,
  normalizeApiSubdomainOverride,
  processEnv,
  updateEnvironment,
  updateEnvironmentApiSubdomain,
  viteEnv,
  windowElectronProcessEnv,
} from '@src/env'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('@src/env', () => {
  describe('default export', () => {
    it('should run the process.env workflow', () => {
      // vite > node.js
      const expected = {
        NODE_ENV: 'place-holder-since-it-will-be-set',
        VITE_ZOO_BASE_DOMAIN: 'dev.zoo.dev',
        VITE_ZOO_API_BASE_URL: 'https://api.dev.zoo.dev',
        VITE_KITTYCAD_WEBSOCKET_URL:
          'wss://api.dev.zoo.dev/ws/modeling/commands',
        VITE_ZOOKEEPER_WEBSOCKET_URL: 'wss://api.dev.zoo.dev/ws/ml/copilot',
        VITE_ZOO_API_TOKEN: 'redacted',
        VITE_ZOO_SITE_BASE_URL: 'https://dev.zoo.dev',
        VITE_ZOO_SITE_APP_URL: 'https://app.dev.zoo.dev',
      }
      const actual = env()
      //@ts-ignore I do not want this token in our logs for any reason.
      actual.VITE_ZOO_API_TOKEN = 'redacted'
      //@ts-ignore I do not want this token in our logs for any reason.
      // I need to mock the value other wise I'd have to delete the key from both
      // actual and expected
      actual.NODE_ENV = 'place-holder-since-it-will-be-set'
      expect(actual).toStrictEqual(expected)
    })
  })
  describe('viteEnv', () => {
    it('should match the EnvironmentVariables key types*', () => {
      // Do not print entire object or compare, it contains a ton of ENV vars.
      // We only need to match against EnvironmentVariables
      const actual = viteEnv()
      expect(typeof actual.NODE_ENV).toBe('string')
      expect(typeof actual.VITE_ZOO_BASE_DOMAIN).toBe('string')
    })
  })
  describe('windowElectronProcessEnv', () => {
    it('should return undefined in vitest runtime', () => {
      const expected = undefined
      const actual = windowElectronProcessEnv()
      expect(actual).toBe(expected)
    })
    describe('When mocking window', () => {
      it('should match the EnvironmentVariable key types*', () => {
        vi.stubGlobal('electron', {
          process: {
            env: {
              NODE_ENV: 'test',
              VITE_ZOO_API_BASE_URL: 'https://api.dev.zoo.dev',
              VITE_KITTYCAD_WEBSOCKET_URL:
                'wss://api.dev.zoo.dev/ws/modeling/commands',
              VITE_ZOOKEEPER_WEBSOCKET_URL:
                'wss://api.dev.zoo.dev/ws/ml/copilot',
              VITE_ZOO_API_TOKEN: 'redacted',
              VITE_ZOO_SITE_BASE_URL: 'https://dev.zoo.dev',
              VITE_ZOO_SITE_APP_URL: 'https://app.dev.zoo.dev',
            },
          },
        })
        const expected = {
          NODE_ENV: 'test',
          VITE_ZOO_API_BASE_URL: 'https://api.dev.zoo.dev',
          VITE_KITTYCAD_WEBSOCKET_URL:
            'wss://api.dev.zoo.dev/ws/modeling/commands',
          VITE_ZOOKEEPER_WEBSOCKET_URL: 'wss://api.dev.zoo.dev/ws/ml/copilot',
          VITE_ZOO_API_TOKEN: 'redacted',
          VITE_ZOO_SITE_BASE_URL: 'https://dev.zoo.dev',
          VITE_ZOO_SITE_APP_URL: 'https://app.dev.zoo.dev',
        }
        const actual = windowElectronProcessEnv()
        expect(actual).toStrictEqual(expected)
        vi.unstubAllGlobals()
      })
    })
    it('should fail on missing window.electron', () => {
      // someone didn't clean up their test if this fails!
      const expected = undefined
      const actual = windowElectronProcessEnv()
      expect(actual).toBe(expected)
      expect(window.electron).toBe(expected)
    })
  })
  describe('processEnv', () => {
    it('should match the EnvironmentVariables key types*', () => {
      // Do not print entire object or compare, it contains a ton of ENV vars.
      // We only need to match against EnvironmentVariables
      const actual = processEnv()
      expect(!!actual).toBe(true)
      expect(typeof actual?.NODE_ENV).toBe('string')
      expect(typeof actual?.VITE_ZOO_BASE_DOMAIN).toBe('string')
    })
  })
  describe('generateDomainsFromBaseDomain', () => {
    it('should generate domains with the empty string', () => {
      const expected = {
        API_URL: 'https://api.',
        SITE_URL: 'https://',
        KITTYCAD_WEBSOCKET_URL: 'wss://api./ws/modeling/commands',
        ZOOKEEPER_WEBSOCKET_URL: 'wss://api./ws/ml/copilot',
        APP_URL: 'https://app.',
      }
      const actual = generateDomainsFromBaseDomain('')
      expect(actual).toStrictEqual(expected)
    })
    it('should generate dev.zoo domains', () => {
      const expected = {
        API_URL: 'https://api.zoo.dev',
        SITE_URL: 'https://zoo.dev',
        KITTYCAD_WEBSOCKET_URL: 'wss://api.zoo.dev/ws/modeling/commands',
        ZOOKEEPER_WEBSOCKET_URL: 'wss://api.zoo.dev/ws/ml/copilot',
        APP_URL: 'https://app.zoo.dev',
      }
      const actual = generateDomainsFromBaseDomain('zoo.dev')
      expect(actual).toStrictEqual(expected)
    })
    it('should generate dev.dev.zoo domains', () => {
      const expected = {
        API_URL: 'https://api.dev.zoo.dev',
        SITE_URL: 'https://dev.zoo.dev',
        KITTYCAD_WEBSOCKET_URL: 'wss://api.dev.zoo.dev/ws/modeling/commands',
        ZOOKEEPER_WEBSOCKET_URL: 'wss://api.dev.zoo.dev/ws/ml/copilot',
        APP_URL: 'https://app.dev.zoo.dev',
      }
      const actual = generateDomainsFromBaseDomain('dev.zoo.dev')
      expect(actual).toStrictEqual(expected)
    })
  })
  describe('getEnvironmentNameFromEnv', () => {
    it('prefers the base domain', () => {
      expect(
        getEnvironmentNameFromEnv({
          VITE_ZOO_BASE_DOMAIN: 'dev.zoo.dev',
          VITE_ZOO_API_BASE_URL: 'https://api.zoo.dev',
        })
      ).toBe('dev.zoo.dev')
    })

    it('derives the environment name from the API URL', () => {
      expect(
        getEnvironmentNameFromEnv({
          VITE_ZOO_BASE_DOMAIN: undefined,
          VITE_ZOO_API_BASE_URL: 'https://api.dev.zoo.dev',
        })
      ).toBe('dev.zoo.dev')
    })

    it('returns undefined when neither source is available', () => {
      expect(
        getEnvironmentNameFromEnv({
          VITE_ZOO_BASE_DOMAIN: undefined,
          VITE_ZOO_API_BASE_URL: undefined,
        })
      ).toBeUndefined()
    })
  })

  describe('runtime API overrides', () => {
    beforeEach(() => {
      vi.stubGlobal('electron', {})
      updateEnvironment('dev.zoo.dev')
    })

    afterEach(() => {
      updateEnvironment(null)
      vi.unstubAllGlobals()
    })

    it('should override the API URL while keeping the selected base domain', () => {
      updateEnvironmentApiSubdomain('dev.zoo.dev', 'api-pr-3072')

      const actual = env()

      expect(actual.VITE_ZOO_BASE_DOMAIN).toBe('dev.zoo.dev')
      expect(actual.VITE_ZOO_API_BASE_URL).toBe(
        'https://api-pr-3072.dev.zoo.dev'
      )
      expect(actual.VITE_ZOO_SITE_BASE_URL).toBe('https://dev.zoo.dev')
      expect(actual.VITE_ZOO_SITE_APP_URL).toBe('https://app.dev.zoo.dev')
      expect(actual.VITE_KITTYCAD_WEBSOCKET_URL).toBe(
        'wss://api.dev.zoo.dev/ws/modeling/commands'
      )
      expect(actual.VITE_ZOOKEEPER_WEBSOCKET_URL).toBe(
        'wss://api.dev.zoo.dev/ws/ml/copilot'
      )
    })

    it('restores the configured API URL when the override is cleared', () => {
      const defaultApiUrl = env().VITE_ZOO_API_BASE_URL
      updateEnvironmentApiSubdomain('dev.zoo.dev', 'api-pr-3072')
      updateEnvironmentApiSubdomain('dev.zoo.dev', '')

      expect(env().VITE_ZOO_API_BASE_URL).toBe(defaultApiUrl)
    })

    it('keeps the override for the same environment and clears it when switching', () => {
      updateEnvironmentApiSubdomain('dev.zoo.dev', 'api-pr-3072')
      updateEnvironment('dev.zoo.dev')
      expect(env().VITE_ZOO_API_BASE_URL).toBe(
        'https://api-pr-3072.dev.zoo.dev'
      )

      updateEnvironment('zoo.dev')

      expect(env().VITE_ZOO_BASE_DOMAIN).toBe('zoo.dev')
      expect(env().VITE_ZOO_API_BASE_URL).not.toContain('api-pr-3072')

      updateEnvironmentApiSubdomain('dev.zoo.dev', 'api-pr-3072')
      expect(env().VITE_ZOO_API_BASE_URL).not.toContain('api-pr-3072')
    })
  })

  describe('normalizeApiSubdomainOverride', () => {
    it.each([
      'api-pr-3072',
      'api-pr-3072.dev.zoo.dev',
      ' https://API-PR-3072.dev.zoo.dev/ ',
    ])('accepts a preview subdomain or URL: %s', (requestedValue) => {
      expect(normalizeApiSubdomainOverride(requestedValue, 'dev.zoo.dev')).toBe(
        'api-pr-3072'
      )
    })

    it.each([
      'api/path',
      'api?query',
      'api#fragment',
      'user@api',
      '-api',
      'api-',
      'a'.repeat(64),
    ])('rejects invalid DNS labels: %s', (requestedValue) => {
      expect(
        normalizeApiSubdomainOverride(requestedValue, 'dev.zoo.dev')
      ).toBeInstanceOf(Error)
    })

    it('accepts an empty value to clear the override', () => {
      expect(normalizeApiSubdomainOverride('  ', 'dev.zoo.dev')).toBe('')
    })
  })
})
