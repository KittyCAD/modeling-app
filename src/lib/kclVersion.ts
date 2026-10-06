import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

const DEFAULT_KCL_VERSION_INTERNAL: KclVersion = '3.0'
const DEFAULT_KCL_VERSION_PUBLIC: KclVersion = '3.0'
export const DEFAULT_KCL_VERSION: KclVersion = IS_STAGING_OR_DEBUG
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
