import type { MouseEventHandler } from 'react'

import { reportRejection } from '@src/lib/trap'

export const openExternalBrowserIfDesktop = (to?: string) =>
  function (e) {
    if (window.electron) {
      // currentTarget could be a few different things
      window.electron
        .openExternal(to || e.currentTarget?.href)
        .catch(reportRejection)
      e.preventDefault()
      e.stopPropagation()
      return false
    }
  } as MouseEventHandler<HTMLAnchorElement>

// Open a new browser window desktop style or browser style.
export default async function openWindow(url: string) {
  if (window.electron) {
    await window.electron.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}
