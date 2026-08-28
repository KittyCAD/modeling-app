import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import type {
  FeatureId,
  UserFeaturesService,
} from '@src/contracts/userFeatures'
// Type-only, so this module can be imported without pulling in a few megabytes
// of WebAssembly — which is what a test of the projection wants.
import type { KclWasmModule } from '@src/features/kclAnalysis/wasmModule'

/**
 * The KCL-shaped view of the account's features.
 *
 * `KclRuntimeFlags` is the KCL subset of the same admin-portal feature set
 * `userFeatures` fetches — the binding says as much: "maps 1-1 to the KCL
 * related flags added to the Admin portal and TS". So this is a projection, and
 * it lives here rather than in the features service, which has no business
 * knowing that KCL exists. A feature that gates an agent will be projected by
 * the agent in the same way.
 */
const FLAG_FEATURES: Record<keyof KclRuntimeFlags, FeatureId> = {
  use_cek_executor: 'kcl_cek_executor',
  use_new_lexer_parser: 'kcl_new_lexer_parser',
}

/**
 * Flags for a known feature set.
 *
 * `On` or `Off`, never `Unset`: this is only called once the features have
 * settled, and at that point absence is a real answer rather than an unknown.
 * `Unset` is expressed by not calling `set_kcl_runtime_flags` at all, which is
 * what happens when there is no features service to ask — see the caller.
 */
export function kclRuntimeFlagsFor(
  features: ReadonlySet<FeatureId>
): KclRuntimeFlags {
  return {
    use_cek_executor: features.has(FLAG_FEATURES.use_cek_executor)
      ? 'On'
      : 'Off',
    use_new_lexer_parser: features.has(FLAG_FEATURES.use_new_lexer_parser)
      ? 'On'
      : 'Off',
  }
}

/**
 * Tell the WASM module which KCL features this account has.
 *
 * Deliberately a no-op when there is no features service: a missing field
 * deserialises to `RuntimeFlag::Unset` on the Rust side, which falls back to
 * Rust's own defaults — so saying nothing is a supported answer and the right
 * one when we genuinely do not know.
 *
 * Waits for the features to settle, but only the first time and only up to the
 * service's own bound: the flags are read when KCL builds its executor context,
 * so a late answer would arrive after the decision it was meant to inform.
 */
export function createRuntimeFlagApplier(
  features: () => UserFeaturesService | undefined
) {
  let applied: string | null = null

  return async (wasm: KclWasmModule) => {
    const service = features()
    if (!service) return

    await service.whenSettled()

    const next = JSON.stringify(kclRuntimeFlagsFor(service.features.value))
    if (next === applied) return

    wasm.set_kcl_runtime_flags(next)
    applied = next
  }
}
