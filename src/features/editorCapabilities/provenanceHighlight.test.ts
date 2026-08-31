import { EditorState, StateEffect } from '@codemirror/state'
import { computed, signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import type { Provenance, RangeMark } from '@src/lib/kcl/provenance'
import {
  createProvenanceHighlightCapability,
  highlightedRanges,
  marksField,
} from '@src/features/editorCapabilities/provenanceHighlight'

const DOC = 'triangle = sketch(on = XY) {}\nextrude001 = extrude(triangle)\n'

const stateWith = (doc = DOC) =>
  EditorState.create({ doc, extensions: [marksField] })

/**
 * The effect the capability's binding dispatches.
 *
 * Reached through the capability rather than exported on its own, so the test
 * exercises the same route the buffer does: a set of marks in, a set of
 * decorations out.
 */
const setMarks = (state: EditorState, marks: readonly RangeMark[]) => {
  const captured: StateEffect<unknown>[] = []

  const provenance = signal<Provenance | null>({
    ranges: marks,
    entities: [],
    absence: null,
  })

  const capability = createProvenanceHighlightCapability({
    pointing: () => ({
      pointing: computed(() => null),
      provenance: computed(() => provenance.value),
      point: () => {},
      clear: () => {},
    }),
  })

  capability.bind?.(
    {
      dispatch: (spec: { effects?: StateEffect<unknown> }) => {
        if (spec.effects) captured.push(spec.effects)
      },
    } as never,
    {} as never
  )

  return state.update({ effects: captured }).state
}

describe('decorating what the pointer is connected to', () => {
  it('starts with nothing decorated', () => {
    expect(highlightedRanges(stateWith())).toEqual([])
  })

  /*
   * Two ranges for one hovered face — the call that made it and the line it came
   * from — which is the case a one-range highlight cannot express.
   */
  it('draws every role it is given', () => {
    const state = setMarks(stateWith(), [
      { range: [30, 60, 0], role: 'primary' },
      { range: [0, 29, 0], role: 'origin' },
    ])

    expect(highlightedRanges(state)).toEqual([
      { from: 0, to: 29, role: 'origin' },
      { from: 30, to: 60, role: 'primary' },
    ])
  })

  it('replaces rather than accumulates, because a hover is not a history', () => {
    let state = setMarks(stateWith(), [{ range: [0, 8, 0], role: 'primary' }])
    state = setMarks(state, [{ range: [30, 40, 0], role: 'primary' }])

    expect(highlightedRanges(state)).toEqual([
      { from: 30, to: 40, role: 'primary' },
    ])
  })

  it('clears when there is nothing to point at', () => {
    let state = setMarks(stateWith(), [{ range: [0, 8, 0], role: 'primary' }])
    state = setMarks(state, [])

    expect(highlightedRanges(state)).toEqual([])
  })

  /*
   * The third element is the module id and the top-level module is zero. An
   * offset from an imported module means nothing in this document, and drawing it
   * would tint whatever text happened to sit at that byte.
   */
  it('ignores a range from another module', () => {
    const state = setMarks(stateWith(), [
      { range: [0, 8, 0], role: 'primary' },
      { range: [10, 20, 3], role: 'origin' },
    ])

    expect(highlightedRanges(state)).toEqual([
      { from: 0, to: 8, role: 'primary' },
    ])
  })

  /*
   * Ordinary while somebody types: the graph is from a run against text that has
   * since changed, so a range can point past the end or collapse.
   */
  it('survives a range the document has outgrown', () => {
    const state = setMarks(stateWith('short\n'), [
      { range: [0, 5000, 0], role: 'primary' },
    ])

    expect(highlightedRanges(state)).toEqual([
      { from: 0, to: 6, role: 'primary' },
    ])
  })

  it('drops a range that has collapsed to nothing', () => {
    const state = setMarks(stateWith('short\n'), [
      { range: [900, 5000, 0], role: 'primary' },
    ])

    expect(highlightedRanges(state)).toEqual([])
  })
})

describe('living alongside edits', () => {
  /*
   * Typing somewhere else while the pointer rests is ordinary. A decoration that
   * stayed at its old offsets would be marking the wrong text.
   */
  it('follows the text when something is inserted before it', () => {
    let state = setMarks(stateWith(), [{ range: [30, 40, 0], role: 'primary' }])
    state = state.update({ changes: { from: 0, insert: '// note\n' } }).state

    expect(highlightedRanges(state)).toEqual([
      { from: 38, to: 48, role: 'primary' },
    ])
  })
})

describe('the capability itself', () => {
  const capability = createProvenanceHighlightCapability({
    pointing: () => undefined,
  })

  /* The artifact graph describes one program: the one being executed. */
  it('applies only to the executing buffer', () => {
    expect(capability.appliesTo?.({ executing: true } as never)).toBe(true)
    expect(capability.appliesTo?.({ executing: false } as never)).toBe(false)
  })

  /*
   * A capability whose extension differs between calls asks every buffer to
   * reconfigure, and there is a test elsewhere asserting typing never does that.
   */
  it('returns the same extension every time', () => {
    expect(capability.extension?.({} as never)).toBe(
      capability.extension?.({} as never)
    )
  })

  it('does nothing at all with no pointing service', () => {
    expect(() => capability.bind?.({} as never, {} as never)).not.toThrow()
  })
})
