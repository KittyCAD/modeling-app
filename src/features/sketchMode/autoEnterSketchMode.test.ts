import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { autoEnterSketchMode } from '@src/features/sketchMode/autoEnterSketchMode'
import type { SketchBlockRange } from '@src/lib/kclStdlib/program'

const sketch = (name: string): SketchBlockRange => ({ name, from: 0, to: 100 })

const harness = (options: { sketching?: boolean; typing?: boolean } = {}) => {
  const inSketch = signal<SketchBlockRange | null>(null)
  const sketching = signal(options.sketching ?? false)
  const typing = signal(options.typing ?? false)
  const enter = vi.fn()

  const stop = autoEnterSketchMode({
    sketch: inSketch,
    sketching,
    isTyping: () => typing.value,
    enter,
  })

  return { inSketch, sketching, typing, enter, stop }
}

describe('following the user into a sketch', () => {
  it('enters when the selection lands in a sketch', () => {
    const app = harness()

    app.inSketch.value = sketch('triangle')

    expect(app.enter).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('does nothing while nothing is in a sketch', () => {
    const app = harness()

    app.typing.value = true
    app.typing.value = false

    expect(app.enter).not.toHaveBeenCalled()
    app.stop()
  })

  /* Entering is an event. Being in a sketch is not a standing instruction. */
  it('does not drag the user back after they leave the mode by hand', () => {
    const app = harness()
    app.inSketch.value = sketch('triangle')
    app.sketching.value = true

    // They switch to Model with the cursor still inside the sketch.
    app.sketching.value = false

    expect(app.enter).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('enters again for a different sketch', () => {
    const app = harness()
    app.inSketch.value = sketch('triangle')
    app.inSketch.value = sketch('slot')

    expect(app.enter).toHaveBeenCalledTimes(2)
    app.stop()
  })

  it('enters again after leaving the sketch and coming back', () => {
    const app = harness()
    app.inSketch.value = sketch('triangle')
    app.inSketch.value = null
    app.inSketch.value = sketch('triangle')

    expect(app.enter).toHaveBeenCalledTimes(2)
    app.stop()
  })

  it('does not ask for a mode it is already in', () => {
    const app = harness({ sketching: true })

    app.inSketch.value = sketch('triangle')

    expect(app.enter).not.toHaveBeenCalled()
    app.stop()
  })

  /*
   * A toolbar that rearranges itself under an open palette has moved the button
   * somebody was about to click.
   */
  it('waits while something else is taking keystrokes', () => {
    const app = harness({ typing: true })

    app.inSketch.value = sketch('triangle')

    expect(app.enter).not.toHaveBeenCalled()
    app.stop()
  })

  /*
   * A skipped sketch is not forgotten, it is just not acted on yet.
   *
   * This harness backs `isTyping` with a signal, so the effect re-runs when it
   * changes; the real one reads the DOM, so what wakes it is the next selection
   * or cursor change. Either way the intent survives being skipped, which is the
   * property worth having.
   */
  it('still follows the sketch after being skipped', () => {
    const app = harness({ typing: true })
    app.inSketch.value = sketch('triangle')

    app.typing.value = false

    expect(app.enter).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('stops following once disposed', () => {
    const app = harness()
    app.stop()

    app.inSketch.value = sketch('triangle')

    expect(app.enter).not.toHaveBeenCalled()
  })
})
