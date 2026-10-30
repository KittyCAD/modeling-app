import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type * as Three from 'three'

const renderer = vi.hoisted(() => ({ render: vi.fn(), clear: vi.fn() }))

vi.mock('three', async (original) => {
  const three = await original<typeof Three>()
  return {
    ...three,
    WebGLRenderer: class {
      domElement = Object.defineProperties(document.createElement('canvas'), {
        clientWidth: { value: 800 },
        clientHeight: { value: 600 },
      })
      setClearColor = vi.fn()
      render = renderer.render
      clear = renderer.clear
    },
  }
})

import { SceneInfra } from '@src/clientSideScene/sceneInfra'

describe('client scene rendering ownership', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    frames = new Map()
    nextFrame = 0
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        frames.set(++nextFrame, cb)
        return nextFrame
      })
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id))
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function makeScene() {
    const connection = {
      streamDimensions: { width: 800, height: 600 },
      sendSceneCommand: vi.fn().mockResolvedValue(undefined),
      subscribeTo: vi.fn(),
      subscribeToUnreliable: vi.fn(),
    } as unknown as ConnectionManager
    return new SceneInfra(connection, Promise.resolve({} as ModuleType), () => {
      throw new Error('Rendering does not need settings')
    })
  }
  function tick() {
    const [id, cb] = [...frames][0]
    frames.delete(id)
    cb(16)
  }

  it('starts one animation loop even when several callers request animation', () => {
    const scene = makeScene()
    scene.animate()
    scene.animate()
    expect(frames.size).toBe(1)
    tick()
    expect(renderer.render).toHaveBeenCalledOnce()
    expect(frames.size).toBe(1)
    scene.stop()
    expect(frames.size).toBe(0)
  })

  it('continues rendering 3D overlays when idle modeling or a gizmo stops the 2D renderer', () => {
    const scene = makeScene()
    const owner = { release: scene.retainRendering() }
    scene.animate()
    scene.stop()
    expect(renderer.clear).not.toHaveBeenCalled()
    tick()
    tick()
    expect(renderer.render).toHaveBeenCalledTimes(2)
    expect(frames.size).toBe(1)
    owner.release()
    expect(frames.size).toBe(0)
    expect(renderer.clear).toHaveBeenCalledOnce()
  })

  it('leaves a 2D sketch animation running when the last 3D overlay is removed', () => {
    const scene = makeScene()
    const owner = { release: scene.retainRendering() }
    scene.animate()
    owner.release()
    expect(frames.size).toBe(1)
    tick()
    expect(renderer.render).toHaveBeenCalledOnce()
    scene.stop()
  })
})
