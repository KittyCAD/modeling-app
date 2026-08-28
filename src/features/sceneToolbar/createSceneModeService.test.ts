import { type Signal, signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import type { SceneMode } from '@src/contracts/sceneModes'
import { createSceneModeService } from '@src/features/sceneToolbar/createSceneModeService'

const mode = (id: string, available?: Signal<boolean>): SceneMode => ({
  id,
  title: id,
  ...(available ? { available } : {}),
})

describe('the active scene mode', () => {
  it('starts in the first mode', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching')]),
    })

    expect(service.active.value?.id).toBe('modeling')
  })

  it('is null while nothing has contributed a mode', () => {
    const service = createSceneModeService({ modes: signal([]) })

    expect(service.active.value).toBeNull()
  })

  it('enters a mode that was asked for', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching')]),
    })

    service.enter('sketching')

    expect(service.active.value?.id).toBe('sketching')
  })

  it('ignores a mode that does not exist', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling')]),
    })

    service.enter('welding')

    expect(service.active.value?.id).toBe('modeling')
  })

  it('refuses a mode that cannot be entered', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching', signal(false))]),
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
    })
    service.enter('sketching')

    sketchable.value = true

    expect(service.active.value?.id).toBe('modeling')
  })

  it('resumes a mode it was in once that mode returns', () => {
    const sketchable = signal(true)
    const service = createSceneModeService({
      modes: signal([mode('modeling'), mode('sketching', sketchable)]),
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
    const service = createSceneModeService({ modes })

    modes.value = [mode('annotating', undefined), mode('modeling')]

    expect(service.active.value?.id).toBe('annotating')
  })
})

describe('what a toolbar group last ran', () => {
  it('remembers per group', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling')]),
    })

    service.noteUsed('pattern', 'patternCircular')
    service.noteUsed('transform', 'rotate')

    expect(service.lastUsed.value.get('pattern')).toBe('patternCircular')
    expect(service.lastUsed.value.get('transform')).toBe('rotate')
  })

  it('replaces rather than accumulating', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling')]),
    })

    service.noteUsed('pattern', 'patternLinear')
    service.noteUsed('pattern', 'patternCircular')

    expect(service.lastUsed.value.get('pattern')).toBe('patternCircular')
    expect(service.lastUsed.value.size).toBe(1)
  })

  it('notifies readers, so a face redraws', () => {
    const service = createSceneModeService({
      modes: signal([mode('modeling')]),
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
