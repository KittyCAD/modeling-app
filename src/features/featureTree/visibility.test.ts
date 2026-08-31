import { describe, expect, it } from 'vitest'
import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import {
  hiddenArtifactIds,
  hideOperationFor,
  resolveVisibility,
} from '@src/features/featureTree/visibility'

const sketchValue = (id: string) => ({
  type: 'Sketch',
  value: { artifactId: id },
})

const hideCall = (argument: unknown): Operation =>
  ({
    type: 'StdLibCall',
    name: 'hide',
    sourceRange: [100, 110, 0],
    unlabeledArg: { value: argument },
    labeledArgs: {},
    nodePath: {},
  }) as unknown as Operation

const call = (name: string, range: [number, number]): Operation =>
  ({
    type: 'StdLibCall',
    name,
    sourceRange: [range[0], range[1], 0],
    unlabeledArg: null,
    labeledArgs: {},
    nodePath: {},
  }) as unknown as Operation

const sketchBlockGroup = (range: [number, number]): Operation =>
  ({
    type: 'GroupBegin',
    group: { type: 'SketchBlock' },
    sourceRange: [range[0], range[1], 0],
    nodePath: {},
  }) as unknown as Operation

const graph = (...entries: [string, Artifact][]): ArtifactMap =>
  new Map(entries)

const artifact = (type: string, range: [number, number]): Artifact =>
  ({ type, codeRef: { range: [range[0], range[1], 0] } }) as unknown as Artifact

describe('reading what the program hides', () => {
  it('collects the artifact a hide call names', () => {
    expect(hiddenArtifactIds([hideCall(sketchValue('s1'))])).toEqual(
      new Set(['s1'])
    )
  })

  /* `hide([a, b])` arrives as an array of the value variants. */
  it('collects every artifact in a list', () => {
    const argument = {
      type: 'Array',
      value: [sketchValue('s1'), sketchValue('s2')],
    }
    expect(hiddenArtifactIds([hideCall(argument)])).toEqual(
      new Set(['s1', 's2'])
    )
  })

  /*
   * The Rust enum tags variants without renaming fields, so some carry the id
   * directly and some one level down. Reading only the nested shape is what made
   * hidden planes and imported geometry invisible in the existing app.
   */
  it('reads both shapes the id arrives in', () => {
    expect(
      hiddenArtifactIds([
        hideCall({ type: 'Plane', artifact_id: 'p1' }),
        hideCall({ type: 'Helix', value: { artifactId: 'h1' } }),
      ])
    ).toEqual(new Set(['p1', 'h1']))
  })

  it('ignores operations that are not hide calls', () => {
    expect(hiddenArtifactIds([call('extrude', [0, 10])])).toEqual(new Set())
  })

  it('finds which call hides a given artifact', () => {
    const first = hideCall(sketchValue('s1'))
    const second = hideCall(sketchValue('s2'))

    expect(hideOperationFor([first, second], 's2')).toBe(second)
    expect(hideOperationFor([first, second], 's3')).toBeNull()
  })
})

describe('resolveVisibility', () => {
  it('offers an eye on a helix', () => {
    const state = resolveVisibility({
      operation: call('helix', [0, 20]),
      operations: [],
      artifacts: graph(['h1', artifact('helix', [0, 20])]),
    })

    expect(state.canToggle).toBe(true)
    expect(state.hidden).toBe(false)
  })

  /*
   * Not in the existing app's list. A region evaluates to a `Sketch`, so
   * `hide(region001)` is valid — and a region is exactly the overlapping
   * geometry somebody wants out of the way.
   */
  it('offers one on a region', () => {
    const state = resolveVisibility({
      operation: call('region', [0, 20]),
      operations: [],
      artifacts: graph(['r1', artifact('path', [0, 20])]),
    })

    expect(state.canToggle).toBe(true)
  })

  it('offers one on a sketch block', () => {
    const state = resolveVisibility({
      operation: sketchBlockGroup([0, 40]),
      operations: [],
      artifacts: graph(['b1', artifact('sketchBlock', [0, 40])]),
    })

    expect(state.canToggle).toBe(true)
  })

  it('reports it as hidden when a hide call names its artifact', () => {
    const hide = hideCall(sketchValue('h1'))
    const state = resolveVisibility({
      operation: call('helix', [0, 20]),
      operations: [hide],
      artifacts: graph(['h1', artifact('helix', [0, 20])]),
    })

    expect(state.hidden).toBe(true)
    expect(state.hideOperation).toBe(hide)
  })

  it('offers nothing on an operation `hide` does not accept', () => {
    expect(
      resolveVisibility({
        operation: call('extrude', [0, 20]),
        operations: [],
        artifacts: graph(['e1', artifact('sweep', [0, 20])]),
      }).canToggle
    ).toBe(false)
  })

  /*
   * The useful third answer: hideable in principle, but the last run produced
   * nothing to hide. An eye that does nothing is worse than no eye.
   */
  it('offers nothing when the run produced no artifact for it', () => {
    expect(
      resolveVisibility({
        operation: call('helix', [0, 20]),
        operations: [],
        artifacts: graph(),
      }).canToggle
    ).toBe(false)
  })

  it('matches on the exact range, not on overlap', () => {
    // An operation and the artifact it produced were written by the same call.
    // Anything looser finds a segment inside a sketch rather than the sketch.
    expect(
      resolveVisibility({
        operation: call('helix', [0, 20]),
        operations: [],
        artifacts: graph(['h1', artifact('helix', [0, 25])]),
      }).canToggle
    ).toBe(false)
  })

  it('refuses a sketch-block row whose artifact is not a sketch block', () => {
    expect(
      resolveVisibility({
        operation: sketchBlockGroup([0, 40]),
        operations: [],
        artifacts: graph(['s1', artifact('segment', [0, 40])]),
      }).canToggle
    ).toBe(false)
  })
})
