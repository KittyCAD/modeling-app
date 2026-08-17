import type { Feature } from '@kittycad/lib'
import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import {
  KCL_CEK_EXECUTOR_FEATURE_FLAG,
  KCL_NEW_LEXER_PARSER_FEATURE_FLAG,
} from '@src/lib/constants'
import {
  kclRuntimeFlagsEqual,
  kclRuntimeFlagsFromUserFeatures,
  setKclRuntimeFlagsOnWasm,
  waitForSettledKclRuntimeFlags,
} from '@src/lib/kclRuntimeFlags'
import {
  type UserFeaturesSettleSnapshot,
  UserFeaturesState,
} from '@src/machines/userFeaturesMachine'
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

describe('kclRuntimeFlagsEqual', () => {
  it('is true only when both flags match', () => {
    const flags: KclRuntimeFlags = {
      use_cek_executor: 'On',
      use_new_lexer_parser: 'Off',
    }
    expect(kclRuntimeFlagsEqual(flags, { ...flags })).toBe(true)
    expect(
      kclRuntimeFlagsEqual(flags, { ...flags, use_cek_executor: 'Off' })
    ).toBe(false)
    expect(
      kclRuntimeFlagsEqual(flags, { ...flags, use_new_lexer_parser: 'On' })
    ).toBe(false)
  })

  it('compares fields added to the runtime payload', () => {
    type ExtendedKclRuntimeFlags = KclRuntimeFlags & {
      future_flag: 'Off' | 'On'
    }
    const flags: ExtendedKclRuntimeFlags = {
      use_cek_executor: 'On',
      use_new_lexer_parser: 'Off',
      future_flag: 'On',
    }
    const differentFutureFlag: ExtendedKclRuntimeFlags = {
      ...flags,
      future_flag: 'Off',
    }

    expect(kclRuntimeFlagsEqual(flags, differentFutureFlag)).toBe(false)
    expect(
      kclRuntimeFlagsEqual(flags, {
        use_cek_executor: 'On',
        use_new_lexer_parser: 'Off',
      })
    ).toBe(false)
  })
})

describe('waitForSettledKclRuntimeFlags', () => {
  function gatedUserFeatures() {
    let settled = false
    let featureIds = new Set<Feature>()
    const listeners = new Set<(snapshot: UserFeaturesSettleSnapshot) => void>()
    const snapshot = (): UserFeaturesSettleSnapshot => ({
      matches: (state) => settled && state === UserFeaturesState.Ready,
      context: {},
    })
    return {
      userFeatures: {
        has: (featureFlagId: Feature, defaultValue: boolean) =>
          featureIds.has(featureFlagId) ? true : defaultValue,
        actor: {
          getSnapshot: snapshot,
          subscribe: (
            listener: (snapshot: UserFeaturesSettleSnapshot) => void
          ) => {
            listeners.add(listener)
            return { unsubscribe: () => listeners.delete(listener) }
          },
        },
      },
      settleWith: (nextFeatureIds: Set<Feature>) => {
        settled = true
        featureIds = nextFeatureIds
        for (const listener of listeners) {
          listener(snapshot())
        }
      },
    }
  }

  it('returns the current flags when already settled', async () => {
    const { userFeatures, settleWith } = gatedUserFeatures()
    settleWith(new Set([KCL_CEK_EXECUTOR_FEATURE_FLAG]))

    expect(await waitForSettledKclRuntimeFlags(userFeatures)).toEqual({
      use_cek_executor: 'On',
      use_new_lexer_parser: 'Off',
    })
  })

  it('waits for settlement and returns the post-settle flags', async () => {
    const { userFeatures, settleWith } = gatedUserFeatures()
    const resolved = vi.fn()
    const pending = waitForSettledKclRuntimeFlags(userFeatures).then(
      (flags) => {
        resolved(flags)
        return flags
      }
    )

    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()

    settleWith(new Set([KCL_CEK_EXECUTOR_FEATURE_FLAG]))
    expect(await pending).toEqual({
      use_cek_executor: 'On',
      use_new_lexer_parser: 'Off',
    })
  })
})
