import { MouseEventHandler } from 'react'
import { isDesktop } from 'lib/isDesktop'
import { reportRejection } from './trap'

export const openExternalBrowserIfDesktop = (to?: string) =>
  function (e) {
    if (isDesktop()) {
      // Ignoring because currentTarget could be a few different things
      // @ts-ignore
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
  if (isDesktop()) {
    await window.electron.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}
