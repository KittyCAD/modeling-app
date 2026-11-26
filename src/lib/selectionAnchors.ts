const setting = 'selectAnything.useAnchors'

export function shouldInjectSelectionAnchors(): boolean {
  return globalThis.localStorage?.getItem(setting) !== 'false'
}

export function setInjectSelectionAnchors(enabled: boolean) {
  globalThis.localStorage?.setItem(setting, String(enabled))
}
