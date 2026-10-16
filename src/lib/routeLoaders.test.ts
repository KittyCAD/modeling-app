import { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
import { fileLoader } from '@src/lib/routeLoaders'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Transitive loader imports reach this wrapper even though redirects never use
// Wasm. Unit tests run without the generated Wasm JavaScript or binary.
vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

// Keep application bootstrap and Wasm out of this route regression test.
vi.mock('@src/lib/app', () => ({
  App: class {
    static getDefaultSystems() {
      return {}
    }

    beginFileRouteLoad = vi.fn(() => vi.fn())
    registry = { get: vi.fn() }
    settings = { actor: {} }
    singletons = { kclManager: { wasmInstancePromise: Promise.resolve({}) } }
  },
}))

vi.mock('@src/lib/settings/settingsUtils', () => ({
  loadAndValidateSettings: vi.fn(() =>
    Promise.reject(new Error('Unexpected project lookup for a legacy bookmark'))
  ),
}))

describe('fileLoader legacy web bookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['/browser', '/browser/main.kcl', '/browser/old-project/main.kcl'])(
    'redirects the legacy file id %s home before looking up a project',
    async (id) => {
      const app = new App(App.getDefaultSystems())
      const request = new Request(
        `https://app.zoo.dev${PATHS.FILE}/${encodeURIComponent(id)}`
      )

      // React Router decodes the :id segment before calling the loader.
      const result = await fileLoader({ app })({
        request,
        params: { id },
        context: undefined,
        unstable_pattern: `${PATHS.FILE}/:id`,
      })

      expect(result).toBeInstanceOf(Response)
      if (!(result instanceof Response)) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new Error('Expected a redirect response')
      }
      expect(result.status).toBe(302)
      expect(result.headers.get('Location')).toBe(PATHS.HOME)
      expect(loadAndValidateSettings).not.toHaveBeenCalled()
    }
  )
})
