import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import { KCL_NEW_LEXER_PARSER_FEATURE_FLAG } from '@src/lib/constants'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { UserFeaturesRegistryService } from '@src/registry/contracts/userFeatures'

type RuntimeFlagUserFeatures = Pick<UserFeaturesRegistryService, 'has'>
type RuntimeFlagWasmInstance = Pick<ModuleType, 'set_kcl_runtime_flags'>

export function kclRuntimeFlagsFromUserFeatures(
  userFeatures: RuntimeFlagUserFeatures
): KclRuntimeFlags {
  return {
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
