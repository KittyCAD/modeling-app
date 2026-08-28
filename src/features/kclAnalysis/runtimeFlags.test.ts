import { computed, signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type {
  FeatureId,
  UserFeaturesService,
} from '@src/contracts/userFeatures'
import {
  createRuntimeFlagApplier,
  kclRuntimeFlagsFor,
} from '@src/features/kclAnalysis/runtimeFlags'
import type { KclWasmModule } from '@src/features/kclAnalysis/wasmModule'

function createFakeFeatures(ids: FeatureId[] = []) {
  const features = signal<ReadonlySet<FeatureId>>(new Set(ids))

  return {
    features,
    service: {
      status: computed(() => 'ready' as const),
      features: computed(() => features.value),
      error: computed(() => null),
      settled: computed(() => true),
      has: (feature: FeatureId) => features.value.has(feature),
      whenSettled: async () => features.value,
      refresh: async () => {},
    } satisfies UserFeaturesService,
  }
}

const createFakeWasm = () => {
  const applied: string[] = []
  return {
    applied,
    wasm: {
      set_kcl_runtime_flags: (json: string) => {
        applied.push(json)
      },
    } as unknown as KclWasmModule,
  }
}

describe('kclRuntimeFlagsFor', () => {
  it('is Off for a feature the account does not have', () => {
    expect(kclRuntimeFlagsFor(new Set())).toEqual({
      use_cek_executor: 'Off',
      use_new_lexer_parser: 'Off',
    })
  })

  it('is On for the ones it does', () => {
    expect(kclRuntimeFlagsFor(new Set(['kcl_new_lexer_parser']))).toEqual({
      use_cek_executor: 'Off',
      use_new_lexer_parser: 'On',
    })
  })

  /**
   * Never `Unset`. Once the features have settled, absence is a real answer —
   * `Unset` means "nobody told me", which is expressed by not calling
   * `set_kcl_runtime_flags` at all.
   */
  it('never reports a flag as unset', () => {
    const flags = kclRuntimeFlagsFor(new Set(['kcl_cek_executor']))
    expect(Object.values(flags)).not.toContain('Unset')
  })
})

describe('applying runtime flags', () => {
  it('says nothing when there is no features service', async () => {
    const { wasm, applied } = createFakeWasm()
    const apply = createRuntimeFlagApplier(() => undefined)

    await apply(wasm)

    // Silence is the answer that leaves Rust on its own defaults.
    expect(applied).toEqual([])
  })

  it('sets the flags once the features are known', async () => {
    const { wasm, applied } = createFakeWasm()
    const { service } = createFakeFeatures(['kcl_cek_executor'])
    const apply = createRuntimeFlagApplier(() => service)

    await apply(wasm)

    expect(applied).toEqual([
      JSON.stringify({ use_cek_executor: 'On', use_new_lexer_parser: 'Off' }),
    ])
  })

  it('does not repeat itself for every parse', async () => {
    const { wasm, applied } = createFakeWasm()
    const { service } = createFakeFeatures()
    const apply = createRuntimeFlagApplier(() => service)

    await apply(wasm)
    await apply(wasm)
    await apply(wasm)

    expect(applied).toHaveLength(1)
  })

  it('sets them again when the answer changes', async () => {
    const { wasm, applied } = createFakeWasm()
    const { service, features } = createFakeFeatures()
    const apply = createRuntimeFlagApplier(() => service)

    await apply(wasm)
    features.value = new Set(['kcl_new_lexer_parser'])
    await apply(wasm)

    expect(applied).toHaveLength(2)
    expect(applied[1]).toContain('"use_new_lexer_parser":"On"')
  })

  it('waits for the features to settle before deciding', async () => {
    const { wasm, applied } = createFakeWasm()
    const whenSettled = vi.fn(async () => new Set<FeatureId>())
    const { service } = createFakeFeatures()

    await createRuntimeFlagApplier(() => ({ ...service, whenSettled }))(wasm)

    // The flags are read when KCL builds its executor context, so a late answer
    // would arrive after the decision it was meant to inform.
    expect(whenSettled).toHaveBeenCalledOnce()
    expect(applied).toHaveLength(1)
  })
})
