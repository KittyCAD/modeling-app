/** The path the Zookeeper websocket lives at, on every Zoo API host. */
const COPILOT_PATH = '/ws/ml/copilot'

/** Where the API lives when nothing says otherwise, as the auth flows have it. */
const DEFAULT_API_BASE_URL = 'https://api.zoo.dev'

export interface ZookeeperUrlInput {
  /** A full websocket URL, replacing everything derived below. */
  override?: string | undefined
  /** The API host, shared with the auth flows and the cloud API. */
  apiBaseUrl?: string | undefined
}

/**
 * The websocket URL for the Zookeeper service.
 *
 * **Derived rather than required.** The service is not an optional add-on that a
 * build either has or lacks — it is a route on the same API host the app already
 * signs in against, so asking for it separately meant every developer met a
 * panel claiming the build had no service configured when the service was
 * exactly where it always is. `main` derives it the same way, from the base
 * domain; this branch spells the host as `VITE_KC_API_BASE_URL` because that is
 * what `deviceIssuerUrl` and `cloudApi` already read.
 *
 * `VITE_ZOOKEEPER_WEBSOCKET_URL` stays as a full-URL override, which is how you
 * point at a local service or at a PR deployment — and because the connection
 * parses it with `new URL`, an override carrying a query (`?pr=1234`) keeps it.
 *
 * Returns `undefined` only when the host is unusable, so a typo still reaches
 * the user as "no service configured" rather than as a failure to connect over
 * and over.
 */
export function zookeeperServiceUrl(
  input: ZookeeperUrlInput
): string | undefined {
  const override = input.override?.trim()
  if (override !== undefined && override !== '') return override

  const host = input.apiBaseUrl?.trim()
  const base = host === undefined || host === '' ? DEFAULT_API_BASE_URL : host

  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    return undefined
  }

  // Websocket schemes only: `new WebSocket('https://…')` throws in every engine.
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:'
  else if (parsed.protocol === 'http:') parsed.protocol = 'ws:'
  else if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
    return undefined
  }

  /*
   * The host's own path is kept, so an API served under a prefix still works,
   * but a bare `/` would otherwise produce `//ws/ml/copilot`.
   */
  const prefix = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = `${prefix}${COPILOT_PATH}`
  return parsed.toString()
}
