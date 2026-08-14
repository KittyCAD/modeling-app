import { describe, expect, it } from 'vitest'

import { getZookeeperProjectReloadBehavior } from '@src/components/openedProjectUtils'

describe('getZookeeperProjectReloadBehavior', () => {
  it('exits sketch solve mode before reloading zookeeper edits', () => {
    expect(
      getZookeeperProjectReloadBehavior({
        matches: (value) => value === 'sketchSolveMode',
      })
    ).toBe('exit-sketch-solve')
  })

  it('skips the forced camera reset in legacy sketch mode', () => {
    expect(
      getZookeeperProjectReloadBehavior({
        matches: (value) => value === 'Sketch',
      })
    ).toBe('execute-without-camera-reset')
  })

  it('keeps the current behavior outside sketch mode', () => {
    expect(
      getZookeeperProjectReloadBehavior({
        matches: () => false,
      })
    ).toBe('execute-and-reset-camera')
  })
})
