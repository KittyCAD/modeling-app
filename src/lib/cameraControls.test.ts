import { describe, expect, it } from 'vitest'
import {
  cameraSystemToMouseControl,
  mouseControlsToCameraSystem,
} from '@src/lib/cameraControls'

describe('CATIA settings', () => {
  it('loads and saves the catia mouse control preference', () => {
    expect(mouseControlsToCameraSystem('catia')).toBe('CATIA')
    expect(cameraSystemToMouseControl('CATIA')).toBe('catia')
  })
})
