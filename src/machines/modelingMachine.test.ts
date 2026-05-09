import { describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise } from 'xstate'

import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import { modelingMachine } from '@src/machines/modelingMachine'
import { modelingMachineInitialInternalContext } from '@src/machines/modelingSharedContext'

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Timed out waiting for actor')), ms)
  })
}

describe('modelingMachine sketch entry', () => {
  it('routes a cursor inside a sketch block segment to sketch solve edit', async () => {
    const pathToNode = [['body', '']] as any
    const sketchBlockCodeRef = {
      range: [0, 100, 0] as [number, number, number],
      pathToNode,
      nodePath: { steps: [] },
    } as any
    const segmentCodeRef = {
      range: [35, 85, 0] as [number, number, number],
      pathToNode,
      nodePath: { steps: [] },
    } as any
    const sketchBlock: Extract<Artifact, { type: 'sketchBlock' }> = {
      type: 'sketchBlock',
      id: 'sketch-block-1',
      codeRef: sketchBlockCodeRef,
      planeId: 'plane-1',
      sketchId: 7,
    }
    const path: Artifact = {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: sketchBlockCodeRef,
      planeId: 'plane-1',
      segIds: ['segment-1'],
      trajectorySweepId: null,
      consumed: false,
      sketchBlockId: sketchBlock.id,
    }
    const segment: Artifact = {
      type: 'segment',
      id: 'segment-1',
      pathId: path.id,
      edgeIds: [],
      commonSurfaceIds: [],
      codeRef: segmentCodeRef,
    }
    const artifactGraph: ArtifactGraph = new Map()
    artifactGraph.set(sketchBlock.id, sketchBlock)
    artifactGraph.set(path.id, path)
    artifactGraph.set(segment.id, segment)

    const context = {
      ...modelingMachineInitialInternalContext,
      selectionRanges: {
        graphSelections: [
          {
            codeRef: {
              range: [45, 45, 0],
              pathToNode,
            },
          },
        ],
        otherSelections: [],
      },
      kclManager: {
        artifactGraph,
        hidePlanes: vi.fn(),
        showPlanes: vi.fn(),
        sceneInfra: {
          animate: vi.fn(),
          resetMouseListeners: vi.fn(),
          camControls: {
            enablePan: true,
            enableRotate: true,
            syncDirection: 'engineToClient',
          },
        },
      },
      rustContext: {},
      engineCommandManager: {},
      wasmInstance: {},
      commandBarActor: {},
      machineManager: {},
    } as any

    let receivedInput: any
    let markActorStarted: () => void = () => {}
    const actorStarted = new Promise<void>((resolve) => {
      markActorStarted = resolve
    })
    const machine = modelingMachine.provide({
      actors: {
        'animate-to-existing-sketch-solve': fromPromise(async ({ input }) => {
          receivedInput = input
          markActorStarted()
          return await new Promise<any>(() => {})
        }),
      },
    })

    const actor = createActor(machine, { input: context }).start()

    actor.send({ type: 'Enter sketch' })

    await Promise.race([actorStarted, timeout(1_000)])

    expect(actor.getSnapshot().value).toBe('animating to existing sketch solve')
    expect(receivedInput).toEqual(
      expect.objectContaining({
        artifactId: sketchBlock.id,
      })
    )

    actor.stop()
  })
})
