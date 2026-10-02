import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export type KclVersionRange = {
  addedIn?: string | null
  removedIn?: string | null
}

export function isKclVersionAvailable(
  version: KclVersion | null,
  { addedIn, removedIn }: KclVersionRange,
  instance: ModuleType
) {
  return (
    version !== null &&
    instance.is_kcl_version_available(version, addedIn, removedIn)
  )
}
