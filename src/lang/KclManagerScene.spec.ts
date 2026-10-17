import { KclManager } from '@src/lang/KclManager'
import { createKclManagerTestHarness } from '@src/lang/testHelpers/kclManagerTestHarness'
import { File } from '@src/lib/projectSession'
import { effect } from '@preact/signals-core'
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import { describe, expect, it, vi } from 'vitest'

const gizmos = vi.hoisted(() => ({ dispose: vi.fn() }))
vi.mock('@src/components/gizmo/GizmoRenderer', () => ({
  default: class {
    readonly canvas = document.createElement('canvas')
    dispose() {
      gizmos.dispose(this)
    }
  },
}))

describe('editor-owned scene lifetime', () => {
  it('owns independent scenes and releases only the closed editor resources', () => {
    const { app, kclManager } = createKclManagerTestHarness()
    const other = new KclManager('other.kcl', '', kclManager.systemDeps)
    const scene = kclManager.sceneInfra
    const cube = scene.getCubeGizmo('light')
    const axis = scene.getAxisGizmo()
    if (!axis || !cube) throw new Error('Open editors must own their gizmos')
    const disposeAxis = vi.spyOn(axis, 'dispose')
    const disposeRenderer = vi.spyOn(scene.renderer, 'dispose')
    const disposeOther = vi.spyOn(other.sceneInfra.renderer, 'dispose')
    const disposeControls = vi.spyOn(scene.camControls, 'dispose')
    const geometry = new BoxGeometry()
    const material = new MeshBasicMaterial()
    const disposeGeometry = vi.spyOn(geometry, 'dispose')
    const disposeMaterial = vi.spyOn(material, 'dispose')
    scene.scene.add(new Mesh(geometry, material))
    const onCameraChange = vi.spyOn(
      kclManager.sceneEntitiesManager,
      'onCamChange'
    )
    try {
      expect(other.sceneInfra === scene).toBe(false)
      expect(scene.getCubeGizmo('dark') === cube).toBe(true)
      expect(scene.getAxisGizmo() === axis).toBe(true)
      kclManager.close()
      kclManager.close()
      expect(disposeRenderer).toHaveBeenCalledTimes(1)
      expect(disposeControls).toHaveBeenCalledTimes(1)
      expect(gizmos.dispose).toHaveBeenCalledWith(cube)
      expect(disposeAxis).toHaveBeenCalledTimes(1)
      expect(disposeGeometry).toHaveBeenCalledTimes(1)
      expect(disposeMaterial).toHaveBeenCalledTimes(1)
      expect(disposeOther).not.toHaveBeenCalled()
      expect(scene.getCubeGizmo('light')).toBeUndefined()
      expect(scene.getAxisGizmo()).toBeUndefined()
      onCameraChange.mockClear()
      scene.camControls.cameraChange.dispatch()
      scene.baseUnitChange.dispatch()
      expect(onCameraChange).not.toHaveBeenCalled()
    } finally {
      other.close()
      app.dispose()
      vi.restoreAllMocks()
    }
  })

  it('replaces the actor and scene together when the legacy editor reopens', async () => {
    const { app, kclManager } = createKclManagerTestHarness()
    const previous = kclManager.sceneInfra
    const previousEntities = kclManager.sceneEntitiesManager
    const scenes: (typeof previous)[] = []
    const stop = effect(() => {
      scenes.push(kclManager.sceneInfra)
    })
    previous.camControls.camera.position.set(5, 6, 7)
    previous.camControls.target.set(1, 2, 3)
    try {
      const previousActor = await kclManager.modelingActorPromise
      kclManager.close()
      expect(previousActor.getSnapshot().status).toBe('stopped')
      await KclManager.fromFile(
        new File('next.kcl', kclManager.systemDeps.textFileIO),
        kclManager.systemDeps,
        kclManager,
        '',
        { shouldSyncRustOnOpen: false }
      )
      const currentActor = await kclManager.modelingActorPromise
      expect(currentActor === previousActor).toBe(false)
      expect(currentActor.getSnapshot().status).toBe('active')
      const current = kclManager.sceneInfra
      expect(current === previous).toBe(false)
      expect(kclManager.sceneEntitiesManager === previousEntities).toBe(false)
      expect(kclManager.sceneEntitiesManager.sceneInfra === current).toBe(true)
      expect(scenes).toHaveLength(2)
      expect(current.camControls.camera.position.toArray()).toEqual([5, 6, 7])
      expect(current.camControls.target.toArray()).toEqual([1, 2, 3])
      const dispose = vi.spyOn(current, 'dispose')
      kclManager.close()
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(currentActor.getSnapshot().status).toBe('stopped')
    } finally {
      stop()
      app.dispose()
      vi.restoreAllMocks()
    }
  })
})
