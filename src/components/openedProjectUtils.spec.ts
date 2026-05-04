import { describe, expect, it } from 'vitest'

import { getMlEphantProjectReloadBehavior } from '@src/components/openedProjectUtils'

describe('getMlEphantProjectReloadBehavior', () => {
  it('exits sketch solve mode before reloading zookeeper edits', () => {
    expect(
      getMlEphantProjectReloadBehavior({
        matches: (value) => value === 'sketchSolveMode',
      })
    ).toBe('exit-sketch-solve')
  })

  it('skips the forced camera reset in legacy sketch mode', () => {
    expect(
      getMlEphantProjectReloadBehavior({
        matches: (value) => value === 'Sketch',
      })
    ).toBe('execute-without-camera-reset')
  })

  it('keeps the current behavior outside sketch mode', () => {
    expect(
      getMlEphantProjectReloadBehavior({
        matches: () => false,
      })
    ).toBe('execute-and-reset-camera')
  })
})
