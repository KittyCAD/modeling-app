import {
  createDialogModeAdapter,
  createDialogModeAdapterFor,
} from '@src/lib/commandBarConfigs/dialogModeAdapter'
import { describe, expect, expectTypeOf, it } from 'vitest'

const extentAdapter = createDialogModeAdapter({
  key: 'extentType',
  modes: ['distance', 'toFace'] as const,
  infer: (argumentsToSubmit) =>
    argumentsToSubmit.to === undefined ? 'distance' : 'toFace',
  toRaw: (mode) =>
    mode === 'distance'
      ? { to: undefined }
      : { length: undefined, bidirectionalLength: undefined },
})

describe('dialog mode adapter', () => {
  it('prefers a valid explicit UI mode over inferred raw arguments', () => {
    expect(extentAdapter.get({ extentType: 'distance', to: 'endFace' })).toBe(
      'distance'
    )
  })

  it('infers the mode when the explicit value is absent or invalid', () => {
    expect(extentAdapter.get({ to: 'endFace' })).toBe('toFace')
    expect(extentAdapter.get({ extentType: 'invalid', to: 'endFace' })).toBe(
      'toFace'
    )
  })

  it('maps the selected mode to raw arguments without mutating the source', () => {
    const source = {
      extentType: 'toFace',
      to: 'endFace',
      length: 10,
      bidirectionalLength: 4,
    }

    const normalized = extentAdapter.normalize(source)

    expect(normalized).toEqual({
      extentType: 'toFace',
      to: 'endFace',
      length: undefined,
      bidirectionalLength: undefined,
    })
    expect(normalized).not.toBe(source)
    expect(source).toEqual({
      extentType: 'toFace',
      to: 'endFace',
      length: 10,
      bidirectionalLength: 4,
    })
  })

  it('can normalize a caller-selected mode', () => {
    expect(
      extentAdapter.normalize({ to: 'endFace', length: 10 }, 'distance')
    ).toEqual({ extentType: 'distance', to: undefined, length: 10 })
  })

  it('still returns a clone when no raw mapping or inferred mode exists', () => {
    const adapter = createDialogModeAdapter({
      key: 'optionalMode',
      modes: ['enabled', 'disabled'] as const,
      infer: () => undefined,
    })
    const source = { value: 1 }
    const normalized = adapter.normalize(source)

    expect(normalized).toEqual({ value: 1, optionalMode: undefined })
    expect(normalized).not.toBe(source)
  })

  it('preserves tuple and mode union types', () => {
    expectTypeOf(extentAdapter.modes).toEqualTypeOf<
      readonly ['distance', 'toFace']
    >()
    expectTypeOf(extentAdapter.get({})).toEqualTypeOf<
      'distance' | 'toFace' | undefined
    >()

    const candidate: unknown = 'distance'
    if (extentAdapter.isMode(candidate)) {
      expectTypeOf(candidate).toEqualTypeOf<'distance' | 'toFace'>()
    }
  })

  it('can bind mode and raw patches to a command argument schema', () => {
    type TestCommandArgs = {
      extentType?: 'distance' | 'toFace'
      length?: number
      to?: string
    }
    const typedAdapter = createDialogModeAdapterFor<TestCommandArgs>()({
      key: 'extentType',
      modes: ['distance', 'toFace'] as const,
      infer: (argumentsToSubmit) =>
        argumentsToSubmit.to ? 'toFace' : 'distance',
      toRaw: (mode) =>
        mode === 'distance' ? { to: undefined } : { length: undefined },
    })

    expect(typedAdapter.normalize({ to: 'end-face' })).toMatchObject({
      extentType: 'toFace',
      length: undefined,
    })
    expectTypeOf(typedAdapter.key).toEqualTypeOf<'extentType'>()
    expectTypeOf(typedAdapter.get({})).toEqualTypeOf<
      'distance' | 'toFace' | undefined
    >()
  })
})
