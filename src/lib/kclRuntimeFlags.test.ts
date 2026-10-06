import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import {
  kclRuntimeFlagsEqual,
  kclRuntimeFlagsFromUserFeatures,
  waitForSettledKclRuntimeFlags,
} from '@src/lib/kclRuntimeFlags'
import {
  type UserFeaturesSettleSnapshot,
  UserFeaturesState,
} from '@src/machines/userFeaturesMachine'
import { describe, expect, it, vi } from 'vitest'

describe('kcl runtime flags', () => {
  it('keeps the reserved parser flag Off without an API feature lookup', () => {
    const userFeatures = { has: vi.fn().mockReturnValue(true) }

    expect(kclRuntimeFlagsFromUserFeatures(userFeatures).use_new_parser).toBe(
      'Off'
    )
    expect(userFeatures.has).not.toHaveBeenCalled()
  })
})

describe('kclRuntimeFlagsEqual', () => {
  it('is true for matching runtime payloads', () => {
    const flags: KclRuntimeFlags = {
      use_new_parser: 'Off',
    }
    expect(kclRuntimeFlagsEqual(flags, { ...flags })).toBe(true)
  })

  it('compares fields added to the runtime payload', () => {
    type ExtendedKclRuntimeFlags = KclRuntimeFlags & {
      future_flag: 'Off' | 'On'
    }
    const flags: ExtendedKclRuntimeFlags = {
      use_new_parser: 'Off',
      future_flag: 'On',
    }
    const differentFutureFlag: ExtendedKclRuntimeFlags = {
      ...flags,
      future_flag: 'Off',
    }

    expect(kclRuntimeFlagsEqual(flags, differentFutureFlag)).toBe(false)
    expect(
      kclRuntimeFlagsEqual(flags, {
        use_new_parser: 'Off',
      })
    ).toBe(false)
  })
})

describe('waitForSettledKclRuntimeFlags', () => {
  function gatedUserFeatures() {
    let settled = false
    const listeners = new Set<(snapshot: UserFeaturesSettleSnapshot) => void>()
    const snapshot = (): UserFeaturesSettleSnapshot => ({
      matches: (state) => settled && state === UserFeaturesState.Ready,
      context: {},
    })
    return {
      userFeatures: {
        has: vi.fn().mockReturnValue(false),
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
      settle: () => {
        settled = true
        for (const listener of listeners) {
          listener(snapshot())
        }
      },
    }
  }

  it('returns the current flags when already settled', async () => {
    const { userFeatures, settle } = gatedUserFeatures()
    settle()

    expect(await waitForSettledKclRuntimeFlags(userFeatures)).toEqual({
      use_new_parser: 'Off',
    })
  })

  it('waits for settlement and returns the post-settle flags', async () => {
    const { userFeatures, settle } = gatedUserFeatures()
    const resolved = vi.fn()
    const pending = waitForSettledKclRuntimeFlags(userFeatures).then(
      (flags) => {
        resolved(flags)
        return flags
      }
    )

    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()

    settle()
    expect(await pending).toEqual({
      use_new_parser: 'Off',
    })
  })
})
