import {
  modelingStdLibCommandArgs,
  modelingStdLibCommandSummary,
  stdLibCommandArgMetadata,
  stdLibCommandSummary,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type {
  HoleCommandArgs,
  SweepCommandArgs,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { describe, expect, it } from 'vitest'

describe('stdlib command semantic fallbacks', () => {
  it('reads canonical KCL command summaries', () => {
    expect(stdLibCommandSummary('sweep')).toBe(
      'Create a 3D surface or solid by sweeping a sketch along a path.'
    )
  })

  it('offers a modeling command shorthand with centralized product copy', () => {
    expect(modelingStdLibCommandSummary('Sweep')).toBe(
      'Create a 3D surface or solid by sweeping a sketch along a path.'
    )
    expect(modelingStdLibCommandSummary('Extrude')).toBe(
      'Pull a sketch into 3D along its normal or perpendicular.'
    )
  })

  it('does not expose argument docs or defaults without an opt-in', () => {
    const args = modelingStdLibCommandArgs<SweepCommandArgs>('Sweep')

    expect(args.version.description).toBeUndefined()
    expect(args.version).not.toHaveProperty('defaultValue')
    expect(args.translateProfileToPath).not.toHaveProperty('defaultValue')
  })

  it('recognizes the exact fixed 2D length tuple used by Hole', () => {
    const args = modelingStdLibCommandArgs<HoleCommandArgs>('Hole')

    expect(args.cutAt).toMatchObject({
      inputType: 'vector2d',
      required: true,
    })
  })

  it('reads a nested stdlib argument default without building a config', () => {
    expect(
      stdLibCommandArgMetadata('hole::countersink', 'headClearance')
    ).toMatchObject({
      name: 'headClearance',
      ty: 'number(Length)',
      required: false,
      defaultValue: '0',
    })
  })

  it('uses selected argument docs and typed literal defaults as fallbacks', () => {
    const args = modelingStdLibCommandArgs<SweepCommandArgs>('Sweep', {
      stdLibFallbacks: {
        relativeTo: { defaultValue: true },
        translateProfileToPath: { defaultValue: true },
        version: { description: true, defaultValue: true },
      },
    })

    expect(args.relativeTo).toMatchObject({ defaultValue: 'trajectoryCurve' })
    expect(args.translateProfileToPath).toMatchObject({ defaultValue: false })
    expect(args.version).toMatchObject({
      description:
        'What version of the sweeping algorithm to use (leave unspecified or use 0 to use the default algorithm).',
      defaultValue: '0',
    })
  })

  it('keeps Sweep product version config ahead of the KCL default', () => {
    const args = modelingStdLibCommandArgs<SweepCommandArgs>('Sweep', {
      stdLibFallbacks: {
        version: { description: true, defaultValue: true },
      },
      overrides: {
        version: {
          description: 'Use the current product-selected sweep algorithm.',
          defaultValue: '2',
        },
      },
    })

    expect(args.version).toMatchObject({
      description: 'Use the current product-selected sweep algorithm.',
      defaultValue: '2',
    })
  })
})
