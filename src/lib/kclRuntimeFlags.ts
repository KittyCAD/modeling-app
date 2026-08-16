import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import {
  KCL_CEK_EXECUTOR_FEATURE_FLAG,
  KCL_NEW_LEXER_PARSER_FEATURE_FLAG,
} from '@src/lib/constants'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  type UserFeaturesSettleSource,
  waitForUserFeaturesSettled,
} from '@src/machines/userFeaturesMachine'
import type { UserFeaturesRegistryService } from '@src/registry/contracts/userFeatures'

type RuntimeFlagUserFeatures = Pick<UserFeaturesRegistryService, 'has'>

type SettleableRuntimeFlagUserFeatures = RuntimeFlagUserFeatures & {
  actor: UserFeaturesSettleSource
}
type RuntimeFlagWasmInstance = Pick<ModuleType, 'set_kcl_runtime_flags'>

export function kclRuntimeFlagsFromUserFeatures(
  userFeatures: RuntimeFlagUserFeatures
): KclRuntimeFlags {
  return {
    use_cek_executor: userFeatures.has(KCL_CEK_EXECUTOR_FEATURE_FLAG, false)
      ? 'On'
      : 'Off',
    use_new_lexer_parser: userFeatures.has(
      KCL_NEW_LEXER_PARSER_FEATURE_FLAG,
      false
    )
      ? 'On'
      : 'Off',
  }
}

export function setKclRuntimeFlagsOnWasm(
  wasmInstance: RuntimeFlagWasmInstance,
  userFeatures: RuntimeFlagUserFeatures
) {
  wasmInstance.set_kcl_runtime_flags(
    JSON.stringify(kclRuntimeFlagsFromUserFeatures(userFeatures))
  )
}

/** True when both flag sets would configure KCL identically. */
export function kclRuntimeFlagsEqual(
  a: KclRuntimeFlags,
  b: KclRuntimeFlags
): boolean {
  return (
    a.use_cek_executor === b.use_cek_executor &&
    a.use_new_lexer_parser === b.use_new_lexer_parser
  )
}

/**
 * Resolves with the flags once the user-features fetch settles (or after the
 * settle timeout), so consumers installing flags into a fresh wasm instance
 * don't race the fetch and start with the flags' defaults.
 */
export async function waitForSettledKclRuntimeFlags(
  userFeatures: SettleableRuntimeFlagUserFeatures
): Promise<KclRuntimeFlags> {
  await waitForUserFeaturesSettled(userFeatures.actor)
  return kclRuntimeFlagsFromUserFeatures(userFeatures)
}
