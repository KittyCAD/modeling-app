// This value is set by singletons.ts when it initializes kclManager
let currentKclVersion = ''

export function setKclVersion(version: string): void {
  currentKclVersion = version
}

export function getKclVersion(): string {
  return currentKclVersion
}
