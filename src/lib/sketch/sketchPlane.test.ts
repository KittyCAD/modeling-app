import { describe, expect, it } from 'vitest'
import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import { sketchPlaneSource } from '@src/lib/sketch/sketchPlane'

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
