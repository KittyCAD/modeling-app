export type AtprotoDesktopOAuthCallbackRedirectUri =
  `http://127.0.0.1:${number}${string}`

export const ATPROTO_DESKTOP_OAUTH_CALLBACK_PORT = 45173
export const ATPROTO_DESKTOP_OAUTH_CALLBACK_PATH = '/atproto/oauth/callback'
export const ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI =
  `http://127.0.0.1:${ATPROTO_DESKTOP_OAUTH_CALLBACK_PORT}${ATPROTO_DESKTOP_OAUTH_CALLBACK_PATH}` as AtprotoDesktopOAuthCallbackRedirectUri

export type AtprotoDesktopOAuthCallbackStart = {
  redirectUri: AtprotoDesktopOAuthCallbackRedirectUri
}

export type AtprotoDesktopOAuthCallbackResult = {
  redirectUri: AtprotoDesktopOAuthCallbackRedirectUri
  params: [string, string][]
}
