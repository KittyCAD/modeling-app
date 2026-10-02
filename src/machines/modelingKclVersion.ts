import { effect, untracked, type ReadonlySignal } from '@preact/signals-core'
import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { fromCallback, type EventObject } from 'xstate'

export type KclLanguageVersionChanged = {
  type: 'KCL language version changed'
  version: KclVersion | null
}

/** Owned by the modeling actor; invalid source has no usable language version. */
export const watchKclLanguageVersion = fromCallback<
  EventObject,
  { code: ReadonlySignal<string>; wasmInstance: ModuleType }
>(({ input, sendBack }) => {
  let previous: KclVersion | null | undefined
  return effect(() => {
    const result = getKclLanguageVersion(input.code.value, input.wasmInstance)
    const version = isErr(result) ? null : result
    if (version === previous) return
    previous = version
    untracked(() =>
      sendBack({
        type: 'KCL language version changed',
        version,
      } satisfies KclLanguageVersionChanged)
    )
  })
})
