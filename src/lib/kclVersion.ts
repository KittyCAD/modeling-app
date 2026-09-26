import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

export const DEFAULT_KCL_VERSION = IS_STAGING_OR_DEBUG ? '3.0-preview' : '2.0'

// This value is set by singletons.ts when it initializes kclManager
let currentKclVersion = ''

export function setKclVersion(version: string): void {
  currentKclVersion = version
}

export function getKclVersion(): string {
  return currentKclVersion
}
