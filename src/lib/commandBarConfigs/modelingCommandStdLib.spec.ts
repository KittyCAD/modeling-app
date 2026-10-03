import {
  applyModelingCommandDescriptions,
  modelingStdLibCommandArgs,
  stdLibCommandArgDefaultSource,
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

  it('defaults only omitted stdlib descriptions, including multiple command configs', () => {
    const commands = {
      Extrude: { description: undefined },
      Sweep: [
        { description: undefined },
        { description: 'Custom description' },
        { description: '' },
      ],
      'Enter sketch': { description: undefined },
    }

    applyModelingCommandDescriptions(commands)

    expect(commands.Extrude.description).toBe(stdLibCommandSummary('extrude'))
    expect(commands.Sweep.map((config) => config.description)).toEqual([
      stdLibCommandSummary('sweep'),
      'Custom description',
      '',
    ])
    expect(commands['Enter sketch'].description).toBeUndefined()
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

  it('reads literal defaults as KCL source and leaves computed defaults unset', () => {
    expect(
      stdLibCommandArgDefaultSource('hole::countersink', 'headClearance')
    ).toBe('0')
    expect(stdLibCommandArgDefaultSource('sweep', 'version')).toBeUndefined()
  })
})
