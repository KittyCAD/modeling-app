declare module '@atproto/oauth-client-browser' {
  export type OAuthSession = {
    readonly did: string
    getTokenInfo(refresh?: boolean | 'auto'): Promise<{
      aud: string
      iss: string
      scope: string
      expired?: boolean
      expiresAt?: Date
    }>
    fetchHandler(pathname: string, init?: RequestInit): Promise<Response>
  }

  export type BrowserOAuthClientOptions = {
    clientMetadata?: unknown
    handleResolver?: unknown
    responseMode?: 'query' | 'fragment'
    plcDirectoryUrl?: string
    fetch?: typeof fetch
  }

  export class BrowserOAuthClient {
    constructor(options: BrowserOAuthClientOptions)
    init(refresh?: boolean): Promise<
      | {
          session: OAuthSession
          state?: string | null
        }
      | undefined
    >
    restore(sub: string, refresh?: boolean): Promise<OAuthSession>
    revoke(sub: string): Promise<void>
    signInPopup(
      input: string,
      options?: {
        scope?: string
      }
    ): Promise<OAuthSession>
  }
}
