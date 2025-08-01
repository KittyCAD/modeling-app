// https://github.com/electron/electron/issues/2288#issuecomment-337858978
// Thank you
export function isDesktop(): boolean {
  return typeof navigator !== 'undefined' &&
    typeof window.navigator !== 'undefined'
    ? navigator.userAgent.toLowerCase().indexOf('electron') > -1
    : true
}
