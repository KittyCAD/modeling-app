import type {
  ArtifactCameraView,
  ArtifactOrientation,
  ArtifactPoint3d,
  ArtifactProjection,
} from '@rust/kcl-lib/bindings/Artifact'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { applyNamedViewCamera } from '@src/lib/kclNamedViewCamera'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CURRENT_TARGET = { x: 10, y: 20, z: 30 }
const CURRENT_DISTANCE = 50

function mm(x: number, y: number, z: number): ArtifactPoint3d {
  return { x, y, z, units: 'mm' }
}

function dir(x: number, y: number, z: number): ArtifactPoint3d {
  return { x, y, z, units: null }
}

function orientedCamera({
  orientation,
  target = null,
  distance = null,
  projection = 'orthographic',
}: {
  orientation: ArtifactOrientation
  target?: ArtifactPoint3d | null
  distance?: number | null
  projection?: ArtifactProjection
}): ArtifactCameraView {
  return {
    look: { type: 'oriented', orientation },
    target,
    distance,
    projection,
  }
}

function directedCamera({
  direction,
  up = dir(0, 0, 1),
  target = null,
  distance = null,
  projection = 'orthographic',
}: {
  direction: ArtifactPoint3d
  up?: ArtifactPoint3d
  target?: ArtifactPoint3d | null
  distance?: number | null
  projection?: ArtifactProjection
}): ArtifactCameraView {
  return {
    look: { type: 'directed', direction, up },
    target,
    distance,
    projection,
  }
}

function fakes() {
  const setCameraToAxis = vi.fn().mockResolvedValue(undefined)
  const setCameraProjection = vi.fn().mockResolvedValue(undefined)
  const sendSceneCommand = vi.fn().mockResolvedValue(null)

  const sceneInfra = {
    camControls: {
      setCameraToAxis,
      setCameraProjection,
      target: CURRENT_TARGET,
      camera: { position: { distanceTo: () => CURRENT_DISTANCE } },
    },
  } as unknown as SceneInfra

  const engineCommandManager = {
    sendSceneCommand,
  } as unknown as ConnectionManager

  return {
    sceneInfra,
    engineCommandManager,
    setCameraToAxis,
    setCameraProjection,
    sendSceneCommand,
  }
}

function sentCommandTypes(sendSceneCommand: ReturnType<typeof vi.fn>) {
  return sendSceneCommand.mock.calls.map(([command]) => command.cmd.type)
}

describe('applyNamedViewCamera', () => {
  let f: ReturnType<typeof fakes>

  beforeEach(() => {
    f = fakes()
  })

  describe('the curated orientations', () => {
    const AXIS_PER_ORIENTATION: [ArtifactOrientation, string][] = [
      ['front', '-y'],
      ['back', 'y'],
      ['left', '-x'],
      ['right', 'x'],
      ['top', 'z'],
      ['bottom', '-z'],
    ]

    for (const [orientation, axis] of AXIS_PER_ORIENTATION) {
      it(`sends ${orientation} down the ${axis} axis with the view's own target and distance`, async () => {
        await applyNamedViewCamera({
          camera: orientedCamera({
            orientation,
            target: mm(1, 2, 3),
            distance: 7,
          }),
          sceneInfra: f.sceneInfra,
          engineCommandManager: f.engineCommandManager,
        })

        expect(f.setCameraToAxis).toHaveBeenCalledWith({
          axis,
          target: { x: 1, y: 2, z: 3 },
          distance: 7,
        })
      })
    }

    it('routes isometric through view_isometric rather than an axis', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({ orientation: 'isometric' }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraToAxis).not.toHaveBeenCalled()
      expect(sentCommandTypes(f.sendSceneCommand)).toEqual([
        'view_isometric',
        'default_camera_get_settings',
      ])
    })
  })

  describe('framing when the author omitted it', () => {
    it('fits the model when the view has no target', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({ orientation: 'front', distance: 7 }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraToAxis).toHaveBeenCalledWith({
        axis: '-y',
        target: undefined,
        distance: 7,
      })
      expect(sentCommandTypes(f.sendSceneCommand)).toEqual([
        'zoom_to_fit',
        'default_camera_get_settings',
      ])
    })

    it('fits the model when the view has no distance', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({
          orientation: 'front',
          target: mm(1, 2, 3),
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(sentCommandTypes(f.sendSceneCommand)).toContain('zoom_to_fit')
    })

    it('does not fit the model when the view gives both', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({
          orientation: 'front',
          target: mm(1, 2, 3),
          distance: 7,
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(sentCommandTypes(f.sendSceneCommand)).not.toContain('zoom_to_fit')
    })
  })

  describe('a custom direction', () => {
    it('places the camera behind the target along the look direction', async () => {
      await applyNamedViewCamera({
        camera: directedCamera({
          direction: dir(0, 1, 0),
          up: dir(0, 0, 1),
          target: mm(5, 5, 5),
          distance: 4,
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.sendSceneCommand).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          cmd: {
            type: 'default_camera_look_at',
            center: { x: 5, y: 5, z: 5 },
            vantage: { x: 5, y: 1, z: 5 },
            up: { x: 0, y: 0, z: 1 },
          },
        })
      )
      expect(sentCommandTypes(f.sendSceneCommand)).toEqual([
        'default_camera_look_at',
        'default_camera_get_settings',
      ])
    })

    it("falls back to the camera's current target and distance", async () => {
      await applyNamedViewCamera({
        camera: directedCamera({ direction: dir(1, 0, 0) }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.sendSceneCommand).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          cmd: expect.objectContaining({
            center: CURRENT_TARGET,
            vantage: {
              x: CURRENT_TARGET.x - CURRENT_DISTANCE,
              y: CURRENT_TARGET.y,
              z: CURRENT_TARGET.z,
            },
          }),
        })
      )
    })
  })

  describe('projection', () => {
    it('asks for orthographic', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({
          orientation: 'front',
          target: mm(0, 0, 0),
          distance: 1,
          projection: 'orthographic',
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraProjection).toHaveBeenCalledWith('orthographic')
    })

    it('asks for perspective', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({
          orientation: 'front',
          target: mm(0, 0, 0),
          distance: 1,
          projection: 'perspective',
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraProjection).toHaveBeenCalledWith('perspective')
    })

    it('applies the projection before pointing the camera', async () => {
      await applyNamedViewCamera({
        camera: directedCamera({
          direction: dir(0, 1, 0),
          target: mm(0, 0, 0),
          distance: 1,
          projection: 'perspective',
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraProjection.mock.invocationCallOrder[0]).toBeLessThan(
        f.sendSceneCommand.mock.invocationCallOrder[0]
      )
    })
  })
})
