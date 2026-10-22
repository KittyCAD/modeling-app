import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { StdLibCommandArgShape } from '@rust/kcl-lib/bindings/StdLibCommandTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export type KclVersionRange = Partial<
  Pick<StdLibCommandArgShape, 'addedIn' | 'removedIn'>
>

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
