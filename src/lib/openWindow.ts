import type { MouseEventHandler } from 'react'

import { generateDomainsFromBaseDomain } from '@src/env'
import { reportRejection } from '@src/lib/trap'

const docsFallbackURL = `${generateDomainsFromBaseDomain('zoo.dev').SITE_URL}/docs`

export const openExternalBrowserIfDesktop = (to?: string) =>
  async function (e) {
    if (window.electron) {
      // currentTarget could be a few different things
      e.preventDefault()
      e.stopPropagation()
      const targetURL = to || e.currentTarget?.href
      if (!targetURL) {
        return false
      }
      const url = await getExternalURLWithDocsFallback(targetURL)
      window.electron.openExternal(url).catch(reportRejection)
      return false
    }
  } as MouseEventHandler<HTMLAnchorElement>

// Open a new browser window desktop style or browser style.
export default async function openWindow(url: string) {
  const reachableURL = await getExternalURLWithDocsFallback(url)
  if (window.electron) {
    await window.electron.openExternal(reachableURL)
  } else {
    window.open(reachableURL, '_blank')
  }
}

export async function getExternalURLWithDocsFallback(
  url: string
): Promise<string> {
  let parsedURL: URL
  try {
    parsedURL = new URL(url)
  } catch {
    return url
  }

  if (parsedURL.href === docsFallbackURL || parsedURL.pathname !== '/docs') {
    return url
  }

  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok ? url : docsFallbackURL
  } catch {
    return docsFallbackURL
  }
}
