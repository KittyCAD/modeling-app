import { describe, expect, it } from 'vitest'

import {
  isSketchSessionForViewControls,
  shouldLockViewControls,
} from '@src/components/viewControlMenuUtils'

function modelingStateIn(activeState: string) {
  return {
    matches: (state: 'Sketch' | 'sketchSolveMode') => state === activeState,
  }
}

describe('view control menu sketch session helpers', () => {
  it.each(['Sketch', 'sketchSolveMode'])(
    'locks standard view actions in %s when sketch orbit is disabled',
    (activeState) => {
      expect(shouldLockViewControls(modelingStateIn(activeState), false)).toBe(
        true
      )
    }
  )

  it('does not lock standard view actions in sketch mode when sketch orbit is enabled', () => {
    expect(
      shouldLockViewControls(modelingStateIn('sketchSolveMode'), true)
    ).toBe(false)
  })

  it('does not treat other modeling states as sketch sessions', () => {
    expect(isSketchSessionForViewControls(modelingStateIn('idle'))).toBe(false)
    expect(shouldLockViewControls(modelingStateIn('idle'), false)).toBe(false)
  })
})
