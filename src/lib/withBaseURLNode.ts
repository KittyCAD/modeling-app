/**
 * This will not run in the browser, look at withBaseURL
 */
export function withSiteBaseURLNode(path: string): string {
  return process.env.VITE_KC_SITE_BASE_URL + path
}
