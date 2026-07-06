import type { MouseEventHandler } from 'react'

import { generateDomainsFromBaseDomain } from '@src/env'
import { getAllowedExternalURL } from '@src/lib/externalUrls'
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
      try {
        const url = await getExternalURLWithDocsFallback(targetURL)
        window.electron.openExternal(url).catch(reportRejection)
      } catch (error) {
        reportRejection(error)
      }
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
  const allowedURL = getAllowedExternalURL(url)
  if (allowedURL instanceof Error) {
    return Promise.reject(allowedURL)
  }

  const parsedURL = new URL(allowedURL)

  if (parsedURL.href === docsFallbackURL || parsedURL.pathname !== '/docs') {
    return allowedURL
  }

  try {
    const response = await fetch(allowedURL, { method: 'HEAD' })
    return response.ok ? allowedURL : docsFallbackURL
  } catch {
    return docsFallbackURL
  }
}
