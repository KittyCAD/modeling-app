import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@src/lang/wasm'
import { kclSettings } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

// Note: this module is about the KCL *language* version declared in a file's
// `@settings(kclVersion = ...)` annotation. It is unrelated to the kcl-lib
// crate version in src/lib/kclVersion.ts.

// Exhaustive over KclVersion: a future union member fails compilation here
// until it's mapped.
const IS_AT_LEAST_KCL_V3: Record<KclVersion, boolean> = {
  '1.0': false,
  '2.0': false,
  '3.0-preview': true,
}

export function isAtLeastKclV3(
  version: KclVersion | null | undefined
): boolean {
  if (version === null || version === undefined) {
    return false
  }
  return IS_AT_LEAST_KCL_V3[version]
}

/**
 * Whether the program opts into KCL 3.0 semantics via its
 * `@settings(kclVersion = ...)` annotation. Missing or unreadable settings
 * mean the program uses pre-3.0 semantics.
 */
export function programUsesKclV3(
  program: Node<Program>,
  instance: ModuleType
): boolean {
  const settings = kclSettings(program, instance)
  if (err(settings) || settings === null) {
    return false
  }
  return isAtLeastKclV3(settings.kclVersion)
}
