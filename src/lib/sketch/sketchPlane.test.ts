import { describe, expect, it } from 'vitest'
import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import { sketchIdIn, sketchPlaneSource } from '@src/lib/sketch/sketchPlane'

const codeRef = { range: [0, 10, 0], pathToNode: [], nodePath: {} } as never

const graph = (...artifacts: Artifact[]): ArtifactMap =>
  new Map(artifacts.map((artifact) => [artifact.id, artifact]))

const sketchBlock = (
  extra: Partial<Extract<Artifact, { type: 'sketchBlock' }>>
): Artifact => ({
  type: 'sketchBlock',
  id: 'block',
  codeRef,
  sketchId: 7,
  ...extra,
})

describe('sketchPlaneSource', () => {
  it('reads the frame straight out of the graph, converted to millimetres', () => {
    const source = sketchPlaneSource(
      graph(
        sketchBlock({
          planeInfo: {
            origin: { x: 1, y: 0, z: 2, units: 'in' },
            xAxis: { x: 1, y: 0, z: 0, units: null },
            yAxis: { x: 0, y: 1, z: 0, units: null },
            zAxis: { x: 0, y: 0, z: 1, units: null },
          },
        })
      ),
      7
    )

    expect(source).toEqual({
      kind: 'frame',
      frame: {
        origin: { x: 25.4, y: 0, z: 50.8 },
        // Axes are directions, so they cross over untouched.
        xAxis: { x: 1, y: 0, z: 0, units: null },
        yAxis: { x: 0, y: 1, z: 0, units: null },
        zAxis: { x: 0, y: 0, z: 1, units: null },
      },
    })
  })

  it('matches a sketch by the frontend id the artifact already carries', () => {
    const artifacts = graph(
      sketchBlock({ id: 'other', sketchId: 3 }),
      sketchBlock({
        id: 'wanted',
        sketchId: 7,
        planeInfo: {
          origin: { x: 0, y: 0, z: 9, units: 'mm' },
          xAxis: { x: 1, y: 0, z: 0, units: null },
          yAxis: { x: 0, y: 1, z: 0, units: null },
          zAxis: { x: 0, y: 0, z: 1, units: null },
        },
      })
    )

    const source = sketchPlaneSource(artifacts, 7)
    expect(source.kind === 'frame' && source.frame.origin.z).toBe(9)
  })

  it('sends a sketch on a face to the renderer, naming the face', () => {
    const source = sketchPlaneSource(
      graph(sketchBlock({ planeId: 'plane-of-face' }), {
        type: 'planeOfFace',
        id: 'plane-of-face',
        faceId: 'the-wall',
        codeRef,
      }),
      7
    )

    expect(source).toEqual({ kind: 'face', entityId: 'the-wall' })
  })

  it('says why, rather than going blank, when the sketch is not in the run', () => {
    const source = sketchPlaneSource(graph(), 7)
    expect(source.kind).toBe('unavailable')
    expect(source.kind === 'unavailable' && source.reason).toContain('last run')
  })

  it('says why for a sketch on something with no plane at all', () => {
    const source = sketchPlaneSource(graph(sketchBlock({})), 7)
    expect(source.kind).toBe('unavailable')
  })
})

describe('sketchIdIn', () => {
  const block = (sketchId: number, range: [number, number, number]): Artifact =>
    ({
      type: 'sketchBlock',
      id: `block-${sketchId}`,
      sketchId,
      codeRef: { range },
    }) as unknown as Artifact

  /*
   * The bug this function exists for: our range is the whole
   * `s = sketch(on = XY) { … }` declaration and the frontend's is the expression
   * inside it, so the start of the statement falls outside the frontend's range.
   */
  it('matches a declaration range against an expression range', () => {
    expect(sketchIdIn(graph(block(7, [12, 48, 0])), { from: 0, to: 48 })).toBe(
      7
    )
  })

  it('ignores a sketch somewhere else in the file', () => {
    expect(
      sketchIdIn(graph(block(7, [200, 260, 0])), { from: 0, to: 48 })
    ).toBeNull()
  })

  it('counts a block whose range is a single point', () => {
    // An empty sketch can report one, and it is still the sketch you are in.
    expect(sketchIdIn(graph(block(7, [48, 48, 0])), { from: 0, to: 48 })).toBe(
      7
    )
  })

  it('takes the innermost of two that overlap', () => {
    const artifacts = graph(block(1, [0, 200, 0]), block(2, [20, 60, 0]))
    expect(sketchIdIn(artifacts, { from: 30, to: 40 })).toBe(2)
  })

  it('has no answer when the run produced no sketch blocks', () => {
    expect(sketchIdIn(graph(), { from: 0, to: 48 })).toBeNull()
  })
})
