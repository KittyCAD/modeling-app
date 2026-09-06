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

describe('stdlib command metadata', () => {
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

  it('keeps command argument descriptions and defaults explicit', () => {
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
})
