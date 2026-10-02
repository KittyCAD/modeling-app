import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

const DEFAULT_KCL_VERSION_INTERNAL = '3.0'
const DEFAULT_KCL_VERSION_PUBLIC = '2.0'
export const DEFAULT_KCL_VERSION = IS_STAGING_OR_DEBUG
  ? DEFAULT_KCL_VERSION_INTERNAL
  : DEFAULT_KCL_VERSION_PUBLIC

// This value is set by singletons.ts when it initializes kclManager
let currentKclVersion = ''

export function setKclVersion(version: string): void {
  currentKclVersion = version
}

export function getKclVersion(): string {
  return currentKclVersion
}
