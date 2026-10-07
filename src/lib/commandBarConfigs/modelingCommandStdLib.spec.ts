import {
  modelingStdLibCommandArgs,
  modelingStdLibCommandSummary,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { HoleCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { describe, expect, it } from 'vitest'

describe('stdlib command metadata', () => {
  it('reads canonical KCL command summaries', () => {
    expect(modelingStdLibCommandSummary('Sweep')).toBe(
      'Create a 3D surface or solid by sweeping a sketch along a path.'
    )
    expect(modelingStdLibCommandSummary('Enter sketch')).toBeUndefined()
  })

  it('recognizes the exact fixed 2D length tuple used by Hole', () => {
    const args = modelingStdLibCommandArgs<HoleCommandArgs>('Hole')

    expect(args.cutAt).toMatchObject({
      inputType: 'vector2d',
      required: true,
    })
  })
})
