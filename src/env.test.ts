import env from '@src/env'
import { vi } from 'vitest'
import { viteEnv, windowElectronProcessEnv, processEnv, updateEnvironment, getEnvironmentName } from '@src/env'

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
        PROD: undefined,
        TEST: 'true',
        DEV: '1',
        CI: 'true',
             "SOURCES": {
                "VITE_KITTYCAD_API_BASE_URL": ".env.development(.local)",
                   "VITE_KITTYCAD_API_WEBSOCKET_URL": ".env.development(.local)",
                   "VITE_KITTYCAD_SITE_BASE_URL": ".env.development(.local)",
                 },
      }
      const actual = env()
      // Gotcha: If this fails you need a token in .env.development.local
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
      expect(typeof actual.VITE_KITTYCAD_API_WEBSOCKET_URL).toBe('string')
      // Gotcha: If this fails you need a token in .env.development.local
      expect(typeof actual.VITE_KITTYCAD_API_TOKEN).toBe('string')
      expect(typeof actual.VITE_KITTYCAD_SITE_BASE_URL).toBe('string')
      expect(typeof actual.VITE_KITTYCAD_SITE_APP_URL).toBe('string')
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
      expect(typeof actual?.VITE_KITTYCAD_API_WEBSOCKET_URL).toBe('string')
      // Gotcha: If this fails you need a token in .env.development.local
      expect(typeof actual?.VITE_KITTYCAD_API_TOKEN).toBe('string')
      expect(typeof actual?.VITE_KITTYCAD_SITE_BASE_URL).toBe('string')
      expect(typeof actual?.VITE_KITTYCAD_SITE_APP_URL).toBe('string')
      expect(typeof actual?.PROD).toBe('string')
      expect(typeof actual?.TEST).toBe('string')
      expect(typeof actual?.DEV).toBe('string')
      // Don't check CI...
    })
  })

  describe('Environment functions', () =>{
    describe('getEnvironmentName and updateEnvironment', () => {
      it('should return null by default', ()=>{
        const expected = null
        const actual = getEnvironmentName()
        expect(actual).toBe(expected)
      })
      it('should return development', () => {
        const expected = 'development'
        updateEnvironment('development')
        const actual = getEnvironmentName()
        expect(actual).toBe(expected)
        // restore global state to the default value
        updateEnvironment(null)
      })
      it('should return production', () => {
        const expected = 'production'
        updateEnvironment('production')
        const actual = getEnvironmentName()
        expect(actual).toBe(expected)
        // restore global state to the default value
        updateEnvironment(null)
      })
    })
  })
})
