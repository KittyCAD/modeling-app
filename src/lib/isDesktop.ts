// https://github.com/electron/electron/issues/2288#issuecomment-337858978
// Thank you

let canThisBeCached : boolean | null = null
export function isDesktop(): boolean {
  if (canThisBeCached === null) {
    canThisBeCached = navigator.userAgent.toLowerCase().indexOf('electron') > -1
    return canThisBeCached
  } else {
    return canThisBeCached
  }
}
