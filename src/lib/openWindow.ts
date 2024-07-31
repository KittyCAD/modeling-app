import { isDesktop } from 'lib/isDesktop'

export const openExternalBrowserIfDesktop = (to) =>
  function (e) {
    if (isDesktop()) {
      window.electron.openExternal(to || e.currentTarget.href)
      e.preventDefault()
      e.stopPropagation()
      return false
    }
  }

// Open a new browser window desktop style or browser style.
export default async function openWindow(url: string) {
  if (isDesktop()) {
    await window.electron.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}
