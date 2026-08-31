import { describe, expect, it } from 'vitest'
import { zookeeperServiceUrl } from '@src/features/zookeeper/serviceUrl'

describe('zookeeperServiceUrl', () => {
  /**
   * The case that matters: a build that was told nothing still reaches the
   * service, because the service is a route on the default API host.
   */
  it('derives the production URL with no configuration at all', () => {
    expect(zookeeperServiceUrl({})).toBe('wss://api.zoo.dev/ws/ml/copilot')
  })

  it('follows the API host the rest of the app was pointed at', () => {
    expect(zookeeperServiceUrl({ apiBaseUrl: 'https://api.dev.zoo.dev' })).toBe(
      'wss://api.dev.zoo.dev/ws/ml/copilot'
    )
  })

  it('uses ws for a plaintext host, so a local service works', () => {
    expect(zookeeperServiceUrl({ apiBaseUrl: 'http://localhost:8080' })).toBe(
      'ws://localhost:8080/ws/ml/copilot'
    )
  })

  it('accepts a host already given as a websocket URL', () => {
    expect(zookeeperServiceUrl({ apiBaseUrl: 'wss://api.dev.zoo.dev' })).toBe(
      'wss://api.dev.zoo.dev/ws/ml/copilot'
    )
  })

  /** A trailing slash is how people write hosts, and `//ws/…` is not a route. */
  it('does not double the separator on a host with a trailing slash', () => {
    expect(zookeeperServiceUrl({ apiBaseUrl: 'https://api.zoo.dev/' })).toBe(
      'wss://api.zoo.dev/ws/ml/copilot'
    )
  })

  it('keeps a path prefix the host was given', () => {
    expect(
      zookeeperServiceUrl({ apiBaseUrl: 'https://example.test/api' })
    ).toBe('wss://example.test/api/ws/ml/copilot')
  })

  it('prefers an explicit override over anything derived', () => {
    expect(
      zookeeperServiceUrl({
        override: 'ws://localhost:8080/ws/ml/copilot',
        apiBaseUrl: 'https://api.dev.zoo.dev',
      })
    ).toBe('ws://localhost:8080/ws/ml/copilot')
  })

  /**
   * How `main` documents pointing at a PR deployment. The connection parses the
   * URL and adds its own parameters, so the query has to survive being passed
   * through untouched.
   */
  it('passes an override with a query through verbatim', () => {
    expect(
      zookeeperServiceUrl({
        override: 'wss://api.dev.zoo.dev/ws/ml/copilot?pr=1234',
      })
    ).toBe('wss://api.dev.zoo.dev/ws/ml/copilot?pr=1234')
  })

  /** An unset Vite variable arrives as the empty string as often as undefined. */
  it('treats a blank value as unset rather than as a URL', () => {
    expect(zookeeperServiceUrl({ override: '  ', apiBaseUrl: '' })).toBe(
      'wss://api.zoo.dev/ws/ml/copilot'
    )
  })

  /**
   * Undefined rather than a guess: the panel then says the build has no service
   * configured, which is true and actionable, instead of retrying a URL that
   * cannot resolve.
   */
  it('gives up on a host it cannot parse', () => {
    expect(zookeeperServiceUrl({ apiBaseUrl: 'api.zoo.dev' })).toBeUndefined()
  })

  it('gives up on a scheme a websocket cannot use', () => {
    expect(
      zookeeperServiceUrl({ apiBaseUrl: 'ftp://api.zoo.dev' })
    ).toBeUndefined()
  })
})
