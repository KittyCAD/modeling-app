import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { bindSketchModeToSession } from '@src/features/sketchMode/bindSketchModeToSession'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(options: { opens?: boolean } = {}) {
  const sketching = signal(false)
  const open = signal(false)

  const enter = vi.fn(async () => {
    if (options.opens ?? true) open.value = true
  })
  const exit = vi.fn(async () => {
    open.value = false
  })
  const leaveMode = vi.fn(() => {
    sketching.value = false
  })

  const stop = bindSketchModeToSession({
    sketching,
    open,
    enter,
    exit,
    leaveMode,
  })

  return { sketching, open, enter, exit, leaveMode, stop }
}

describe('bindSketchModeToSession', () => {
  it('opens the sketch when the mode is entered', async () => {
    const app = setup()

    app.sketching.value = true
    await settle()

    expect(app.enter).toHaveBeenCalledTimes(1)
    expect(app.open.value).toBe(true)
  })

  it('writes the sketch back when the mode is left', async () => {
    const app = setup()
    app.sketching.value = true
    await settle()

    app.sketching.value = false
    await settle()

    expect(app.exit).toHaveBeenCalledTimes(1)
  })

  it('leaves the mode when the sketch is finished from inside', async () => {
    const app = setup()
    app.sketching.value = true
    await settle()

    // What the Finish button does: close the session directly.
    app.open.value = false
    await settle()

    expect(app.leaveMode).toHaveBeenCalledTimes(1)
    expect(app.sketching.value).toBe(false)
  })

  /*
   * The failure the level-based version has: finishing leaves the mode, and
   * leaving the mode reopens the sketch, forever.
   */
  it('does not reopen the sketch it just finished', async () => {
    const app = setup()
    app.sketching.value = true
    await settle()

    app.open.value = false
    await settle()
    await settle()

    expect(app.enter).toHaveBeenCalledTimes(1)
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('leaves the mode when the sketch could not be opened', async () => {
    const app = setup({ opens: false })

    app.sketching.value = true
    await settle()

    // A mode standing with no sketch behind it is the state this prevents.
    expect(app.leaveMode).toHaveBeenCalledTimes(1)
    expect(app.sketching.value).toBe(false)
  })

  it('does not retry an opening that failed', async () => {
    const app = setup({ opens: false })

    app.sketching.value = true
    await settle()
    await settle()

    expect(app.enter).toHaveBeenCalledTimes(1)
  })

  it('tries again on a fresh arrival', async () => {
    const app = setup({ opens: false })
    app.sketching.value = true
    await settle()

    app.sketching.value = true
    await settle()

    expect(app.enter).toHaveBeenCalledTimes(2)
  })

  it('does nothing to a sketch opened before the mode was', async () => {
    const app = setup()
    app.open.value = true

    app.sketching.value = true
    await settle()

    // Already open: entering the mode has nothing to do.
    expect(app.enter).not.toHaveBeenCalled()
  })

  it('stops when the feature is disposed', async () => {
    const app = setup()
    app.stop()

    app.sketching.value = true
    await settle()

    expect(app.enter).not.toHaveBeenCalled()
  })
})
