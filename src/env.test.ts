import env from '@src/env'
import {
  generateDomainsFromBaseDomain,
  processEnv,
  viteEnv,
  windowElectronProcessEnv,
} from '@src/env'
import { vi } from 'vitest'

describe('@src/env', () => {
  describe('default export', () => {
    it('should run the process.env workflow', () => {
      // vite > node.js
      const expected = {
        NODE_ENV: 'place-holder-since-it-will-be-set',
        VITE_KITTYCAD_BASE_DOMAIN: 'dev.zoo.dev',
        VITE_KITTYCAD_API_BASE_URL: 'https://api.dev.zoo.dev',
        VITE_KITTYCAD_WEBSOCKET_URL:
          'wss://api.dev.zoo.dev/ws/modeling/commands',
        VITE_MLEPHANT_WEBSOCKET_URL: 'wss://api.dev.zoo.dev/ws/ml/copilot',
        VITE_ZOO_API_TOKEN: 'redacted',
        VITE_KITTYCAD_SITE_BASE_URL: 'https://dev.zoo.dev',
        VITE_KITTYCAD_SITE_APP_URL: 'https://app.dev.zoo.dev',
        POOL: '',
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
      expect(typeof actual.VITE_KITTYCAD_BASE_DOMAIN).toBe('string')
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
              VITE_KITTYCAD_API_BASE_URL: 'https://api.dev.zoo.dev',
              VITE_KITTYCAD_WEBSOCKET_URL:
                'wss://api.dev.zoo.dev/ws/modeling/commands',
              VITE_MLEPHANT_WEBSOCKET_URL:
                'wss://api.dev.zoo.dev/ws/ml/copilot',
              VITE_ZOO_API_TOKEN: 'redacted',
              VITE_KITTYCAD_SITE_BASE_URL: 'https://dev.zoo.dev',
              VITE_KITTYCAD_SITE_APP_URL: 'https://app.dev.zoo.dev',
            },
          },
        })
        const expected = {
          NODE_ENV: 'test',
          VITE_KITTYCAD_API_BASE_URL: 'https://api.dev.zoo.dev',
          VITE_KITTYCAD_WEBSOCKET_URL:
            'wss://api.dev.zoo.dev/ws/modeling/commands',
          VITE_MLEPHANT_WEBSOCKET_URL: 'wss://api.dev.zoo.dev/ws/ml/copilot',
          VITE_ZOO_API_TOKEN: 'redacted',
          VITE_KITTYCAD_SITE_BASE_URL: 'https://dev.zoo.dev',
          VITE_KITTYCAD_SITE_APP_URL: 'https://app.dev.zoo.dev',
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
      expect(typeof actual?.VITE_KITTYCAD_BASE_DOMAIN).toBe('string')
    })
  })
  describe('generateDomainsFromBaseDomain', () => {
    it('should generate domains with the empty string', () => {
      const expected = {
        API_URL: 'https://api.',
        SITE_URL: 'https://',
        KITTYCAD_WEBSOCKET_URL: 'wss://api./ws/modeling/commands',
        MLEPHANT_WEBSOCKET_URL: 'wss://api./ws/ml/copilot',
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
        MLEPHANT_WEBSOCKET_URL: 'wss://api.zoo.dev/ws/ml/copilot',
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
        MLEPHANT_WEBSOCKET_URL: 'wss://api.dev.zoo.dev/ws/ml/copilot',
        APP_URL: 'https://app.dev.zoo.dev',
      }
      const actual = generateDomainsFromBaseDomain('dev.zoo.dev')
      expect(actual).toStrictEqual(expected)
    })
  })
})
