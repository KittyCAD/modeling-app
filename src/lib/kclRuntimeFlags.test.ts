import type { Feature } from '@kittycad/lib'
import {
  KCL_CEK_EXECUTOR_FEATURE_FLAG,
  KCL_NEW_LEXER_PARSER_FEATURE_FLAG,
} from '@src/lib/constants'
import {
  kclRuntimeFlagsFromUserFeatures,
  setKclRuntimeFlagsOnWasm,
} from '@src/lib/kclRuntimeFlags'
import { describe, expect, it, vi } from 'vitest'

function userFeaturesWith(features: Set<Feature>) {
  return {
    has: (featureFlagId: Feature, defaultValue: boolean) =>
      features.has(featureFlagId) ? true : defaultValue,
  }
}

describe('kcl runtime flags', () => {
  it('maps an enabled TS feature to On', () => {
    expect(
      kclRuntimeFlagsFromUserFeatures(
        userFeaturesWith(new Set([KCL_NEW_LEXER_PARSER_FEATURE_FLAG]))
      )
    ).toEqual({
      use_cek_executor: 'Off',
      use_new_lexer_parser: 'On',
    })
  })

  it('maps the enabled CEK executor feature to On', () => {
    expect(
      kclRuntimeFlagsFromUserFeatures(
        userFeaturesWith(new Set([KCL_CEK_EXECUTOR_FEATURE_FLAG]))
      )
    ).toEqual({
      use_cek_executor: 'On',
      use_new_lexer_parser: 'Off',
    })
  })

  it('maps a missing TS feature to Off', () => {
    expect(
      kclRuntimeFlagsFromUserFeatures(userFeaturesWith(new Set()))
    ).toEqual({
      use_cek_executor: 'Off',
      use_new_lexer_parser: 'Off',
    })
  })

  it('sets serialized runtime flags on the wasm instance', () => {
    const wasmInstance = {
      set_kcl_runtime_flags: vi.fn(),
    }

    setKclRuntimeFlagsOnWasm(
      wasmInstance,
      userFeaturesWith(new Set([KCL_NEW_LEXER_PARSER_FEATURE_FLAG]))
    )

    expect(wasmInstance.set_kcl_runtime_flags).toHaveBeenCalledWith(
      JSON.stringify({
        use_cek_executor: 'Off',
        use_new_lexer_parser: 'On',
      })
    )
  })
})
