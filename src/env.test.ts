import env from '@src/env'
import { vi } from 'vitest'
import { viteEnv, windowElectronProcessEnv, processEnv } from '@src/env'

describe('@src/env', () => {
  describe('default export', () => {
    it('should run the process.env workflow', () => {
      // vite > node.js
      const expected = {
        NODE_ENV: 'test',
        VITE_KITTYCAD_API_BASE_URL: 'https://api.dev.zoo.dev',
        VITE_KITTYCAD_API_WEBSOCKET_URL:
          'wss://api.dev.zoo.dev/ws/modeling/commands',
        VITE_KITTYCAD_API_TOKEN: 'redacted',
        VITE_KITTYCAD_SITE_BASE_URL: 'https://dev.zoo.dev',
        VITE_KITTYCAD_SITE_APP_URL: 'https://app.dev.zoo.dev',
        VITE_KITTYCAD_CONNECTION_TIMEOUT_MS: '5000',
        PROD: undefined,
        TEST: 'true',
        DEV: '1',
        CI: 'true',
      }
      const actual = env()
      expect(typeof actual.VITE_KITTYCAD_API_TOKEN).toBe('string')
      //@ts-ignore I do not want this token in our logs for any reason.
      actual.VITE_KITTYCAD_API_TOKEN = 'redacted'
      //@ts-ignore need to hard code this for localhost and CI
      actual.CI = 'true'
      expect(actual).toStrictEqual(expected)
    })
  })
  describe('viteEnv', () => {
    it('should match the EnvironmentVariables key types*', () => {
      // Do not print entire object or compare, it contains a ton of ENV vars.
      // We only need to match against EnvironmentVariables
      const actual = viteEnv()
      expect(typeof actual.NODE_ENV).toBe('string')
      expect(typeof actual.VITE_KITTYCAD_API_BASE_URL).toBe('string')
      expect(typeof actual.VITE_KITTYCAD_API_WEBSOCKET_URL).toBe('undefined')
      expect(typeof actual.VITE_KITTYCAD_API_TOKEN).toBe('string')
      expect(typeof actual.VITE_KITTYCAD_SITE_BASE_URL).toBe('string')
      expect(typeof actual.VITE_KITTYCAD_SITE_APP_URL).toBe('string')
      expect(typeof actual.VITE_KITTYCAD_CONNECTION_TIMEOUT_MS).toBe('string')
      expect(typeof actual.PROD).toBe('boolean')
      expect(typeof actual.TEST).toBe('string')
      expect(typeof actual.DEV).toBe('boolean')
      // Don't check CI...
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
              VITE_KITTYCAD_API_WEBSOCKET_URL:
                'wss://api.dev.zoo.dev/ws/modeling/commands',
              VITE_KITTYCAD_API_TOKEN: 'redacted',
              VITE_KITTYCAD_SITE_BASE_URL: 'https://dev.zoo.dev',
              VITE_KITTYCAD_SITE_APP_URL: 'https://app.dev.zoo.dev',
              VITE_KITTYCAD_CONNECTION_TIMEOUT_MS: '5000',
              PROD: undefined,
              TEST: 'true',
              DEV: '1',
              CI: undefined,
            },
          },
        })
        const expected = {
          NODE_ENV: 'test',
          VITE_KITTYCAD_API_BASE_URL: 'https://api.dev.zoo.dev',
          VITE_KITTYCAD_API_WEBSOCKET_URL:
            'wss://api.dev.zoo.dev/ws/modeling/commands',
          VITE_KITTYCAD_API_TOKEN: 'redacted',
          VITE_KITTYCAD_SITE_BASE_URL: 'https://dev.zoo.dev',
          VITE_KITTYCAD_SITE_APP_URL: 'https://app.dev.zoo.dev',
          VITE_KITTYCAD_CONNECTION_TIMEOUT_MS: '5000',
          PROD: undefined,
          TEST: 'true',
          DEV: '1',
          CI: undefined,
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
      expect(typeof actual?.VITE_KITTYCAD_API_BASE_URL).toBe('string')
      expect(typeof actual?.VITE_KITTYCAD_API_WEBSOCKET_URL).toBe('undefined')
      expect(typeof actual?.VITE_KITTYCAD_API_TOKEN).toBe('string')
      expect(typeof actual?.VITE_KITTYCAD_SITE_BASE_URL).toBe('string')
      expect(typeof actual?.VITE_KITTYCAD_SITE_APP_URL).toBe('string')
      expect(typeof actual?.VITE_KITTYCAD_CONNECTION_TIMEOUT_MS).toBe('string')
      expect(typeof actual?.PROD).toBe('string')
      expect(typeof actual?.TEST).toBe('string')
      expect(typeof actual?.DEV).toBe('string')
      // Don't check CI...
    })
  })
})
