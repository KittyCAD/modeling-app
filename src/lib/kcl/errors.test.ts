import { describe, expect, it, vi } from 'vitest'
import { kclErrorMessage } from '@src/lib/kcl/errors'

describe('kclErrorMessage', () => {
  it('reads an ordinary Error', () => {
    expect(kclErrorMessage(new Error('nope'), 'fallback')).toBe('nope')
  })

  it('reads the string kcl-lib formats its own failures as', () => {
    expect(kclErrorMessage('Could not deserialize Version', 'fallback')).toBe(
      'Could not deserialize Version'
    )
  })

  /*
   * The shape that was being thrown away: `KclErrorWithOutputs` wrapping a
   * `KclError` wrapping `KclErrorDetails`.
   */
  it('reaches the message inside a serialised KCL error', () => {
    const rejection = {
      error: {
        kind: 'refactor',
        details: { msg: 'Sketch not found: ObjectId(3)', sourceRanges: [] },
      },
      nonFatal: [],
      sceneGraph: null,
    }

    expect(kclErrorMessage(rejection, 'fallback')).toBe(
      'Sketch not found: ObjectId(3)'
    )
  })

  it('reads a bare KclError too', () => {
    expect(
      kclErrorMessage({ kind: 'semantic', details: { msg: 'bad plane' } }, 'x')
    ).toBe('bad plane')
  })

  it('falls back, loudly, on something it cannot read', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(kclErrorMessage({ weird: true }, 'fallback')).toBe('fallback')
    // The message is the smallest part of what comes back; losing the rest
    // silently is what made this hard to diagnose in the first place.
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('does not spin on a cyclic rejection', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cyclic: { error?: unknown } = {}
    cyclic.error = cyclic

    expect(kclErrorMessage(cyclic, 'fallback')).toBe('fallback')
    logged.mockRestore()
  })
})
