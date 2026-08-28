import { type Signal, signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import type { SceneMode, SceneModeGate } from '@src/contracts/sceneModes'
import { createSceneModeService } from '@src/features/sceneToolbar/createSceneModeService'

const mode = (id: string, available?: Signal<boolean>): SceneMode => ({
  id,
  title: id,
  ...(available ? { available } : {}),
})

const gate = (
  mode: string,
  available: Signal<boolean>,
  reason?: string
): SceneModeGate => ({ id: `gate.${mode}`, mode, available, reason })

const service = (
  modes: Signal<readonly SceneMode[]> | readonly SceneMode[],
  gates: readonly SceneModeGate[] = []
) =>
  createSceneModeService({
    modes: Array.isArray(modes)
      ? signal(modes)
      : (modes as Signal<readonly SceneMode[]>),
    gates: signal(gates),
  })

describe('the active scene mode', () => {
  it('starts in the first mode', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching')]),
      gates: signal([]),
    })

    expect(service.active.value?.id).toBe('modeling')
  })

  it('is null while nothing has contributed a mode', () => {
    const service = createSceneModeService({
      modes: signal([]),
      gates: signal([]),
    })

    expect(service.active.value).toBeNull()
  })

  it('enters a mode that was asked for', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching')]),
      gates: signal([]),
    })

    service.enter('sketching')

    expect(service.active.value?.id).toBe('sketching')
  })

  it('ignores a mode that does not exist', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling')]),
      gates: signal([]),
    })

    service.enter('welding')

    expect(service.active.value?.id).toBe('modeling')
  })

  it('refuses a mode that cannot be entered', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching', signal(false))]),
      gates: signal([]),
    })

    service.enter('sketching')

    expect(service.active.value?.id).toBe('modeling')
  })

  /*
   * The active mode is derived rather than stored, so this cannot strand the
   * scene in a mode with no tools and no way out.
   */
  it('falls back when the active mode stops being available', () => {
    const sketchable = signal(true)
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching', sketchable)]),
      gates: signal([]),
    })
    service.enter('sketching')

    sketchable.value = false

    expect(service.active.value?.id).toBe('modeling')
  })

  /*
   * Being refused is not being queued. Asking for a mode that cannot be entered
   * does nothing now and nothing later — a mode that arrived minutes afterwards,
   * because of a keystroke long forgotten, is worse than no answer.
   */
  it('does not queue a mode it refused', () => {
    const sketchable = signal(false)
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching', sketchable)]),
      gates: signal([]),
    })
    service.enter('sketching')

    sketchable.value = true

    expect(service.active.value?.id).toBe('modeling')
  })

  it('resumes a mode it was in once that mode returns', () => {
    const sketchable = signal(true)
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching', sketchable)]),
      gates: signal([]),
    })
    service.enter('sketching')

    // The sketch closes and reopens: you were sketching, so you are sketching.
    sketchable.value = false
    expect(service.active.value?.id).toBe('modeling')
    sketchable.value = true

    expect(service.active.value?.id).toBe('sketching')
  })

  it('follows a mode contributed later', () => {
    const modes = signal<readonly SceneMode[]>([mode('modeling')])
    const service = createSceneModeService({ modes, gates: signal([]) })

    modes.value = [mode('annotating', undefined), mode('modeling')]

    expect(service.active.value?.id).toBe('annotating')
  })
})

describe('what a toolbar group last ran', () => {
  it('remembers per group', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling')]),
      gates: signal([]),
    })

    service.noteUsed('pattern', 'patternCircular')
    service.noteUsed('transform', 'rotate')

    expect(service.lastUsed.value.get('pattern')).toBe('patternCircular')
    expect(service.lastUsed.value.get('transform')).toBe('rotate')
  })

  it('replaces rather than accumulating', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling')]),
      gates: signal([]),
    })

    service.noteUsed('pattern', 'patternLinear')
    service.noteUsed('pattern', 'patternCircular')

    expect(service.lastUsed.value.get('pattern')).toBe('patternCircular')
    expect(service.lastUsed.value.size).toBe(1)
  })

  it('notifies readers, so a face redraws', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling')]),
      gates: signal([]),
    })
    const seen: (string | undefined)[] = []
    const stop = service.lastUsed.subscribe((map) =>
      seen.push(map.get('pattern'))
    )

    service.noteUsed('pattern', 'patternLinear')
    stop()

    expect(seen).toEqual([undefined, 'patternLinear'])
  })
})

describe('gating a mode', () => {
  it('reports a mode with no gates as available', () => {
    const app = service([mode('modeling')])

    expect(app.availability('modeling')).toEqual({ available: true })
  })

  it('closes a mode whose gate is closed, with the gate reason', () => {
    const closed = signal(false)
    const app = service(
      [mode('modeling'), mode('sketching')],
      [gate('sketching', closed, 'Select something inside a sketch.')]
    )

    expect(app.availability('sketching')).toEqual({
      available: false,
      reason: 'Select something inside a sketch.',
    })
  })

  /* A gate can only take a mode away, so one closed gate is enough. */
  it('needs every gate for a mode to agree', () => {
    const app = service(
      [mode('sketching')],
      [
        gate('sketching', signal(true), 'first'),
        { id: 'second', mode: 'sketching', available: signal(false) },
      ]
    )

    expect(app.availability('sketching').available).toBe(false)
  })

  it('ignores gates for other modes', () => {
    const app = service(
      [mode('modeling'), mode('sketching')],
      [gate('sketching', signal(false))]
    )

    expect(app.availability('modeling').available).toBe(true)
  })

  it('refuses to enter a gated mode', () => {
    const app = service(
      [mode('modeling'), mode('sketching')],
      [gate('sketching', signal(false))]
    )

    app.enter('sketching')

    expect(app.active.value?.id).toBe('modeling')
  })

  it('enters it once the gate opens', () => {
    const open = signal(false)
    const app = service(
      [mode('modeling'), mode('sketching')],
      [gate('sketching', open)]
    )

    open.value = true
    app.enter('sketching')

    expect(app.active.value?.id).toBe('sketching')
  })

  it('falls back out of a mode whose gate closes under it', () => {
    const open = signal(true)
    const app = service(
      [mode('modeling'), mode('sketching')],
      [gate('sketching', open)]
    )
    app.enter('sketching')

    open.value = false

    expect(app.active.value?.id).toBe('modeling')
  })

  it('does not start in a gated mode, even when it sorts first', () => {
    const app = service(
      [mode('sketching'), mode('modeling')],
      [gate('sketching', signal(false))]
    )

    expect(app.active.value?.id).toBe('modeling')
  })

  it('says nothing about a mode that does not exist', () => {
    const app = service([mode('modeling')])

    expect(app.availability('welding')).toEqual({ available: false })
  })
})

/*
 * Entering a mode is inferred, so leaving has to be sayable — otherwise the
 * condition that entered it is still true and nothing takes you out.
 */
describe('leaving a mode', () => {
  it('lands back on the first mode', () => {
    const app = service([mode('modeling'), mode('sketching')])
    app.enter('sketching')

    app.reset()

    expect(app.active.value?.id).toBe('modeling')
  })

  it('forgets the request rather than naming a mode to enter', () => {
    const later = signal<readonly SceneMode[]>([mode('modeling')])
    const app = createSceneModeService({ modes: later, gates: signal([]) })
    app.enter('modeling')
    app.reset()

    // A mode contributed later becomes where you land, without `reset` knowing.
    later.value = [mode('inspecting'), mode('modeling')]

    expect(app.active.value?.id).toBe('inspecting')
  })

  it('can be entered again afterwards', () => {
    const app = service([mode('modeling'), mode('sketching')])
    app.enter('sketching')
    app.reset()

    app.enter('sketching')

    expect(app.active.value?.id).toBe('sketching')
  })

  it('does nothing when nothing was asked for', () => {
    const app = service([mode('modeling'), mode('sketching')])

    app.reset()

    expect(app.active.value?.id).toBe('modeling')
  })
})
