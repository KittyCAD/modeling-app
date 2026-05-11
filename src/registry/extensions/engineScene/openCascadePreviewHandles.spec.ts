import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
} from 'three'
import { describe, expect, it } from 'vitest'

import {
  OPEN_CASCADE_PREVIEW_HANDLE_ROOT,
  rebuildOpenCascadePreviewHandleDebugRoot,
  rebuildOpenCascadePreviewHandleRoot,
} from './openCascadePreviewHandles'

describe('OpenCascade preview handles', () => {
  it('builds a visible linear-distance handle with real colored geometry', () => {
    const root = new Group()
    const previewRoot = new Group()
    const body = new Mesh(
      new BoxGeometry(10, 10, 2),
      new MeshBasicMaterial({ color: 0x888888 })
    )
    previewRoot.add(body)
    const camera = new PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(20, 20, 20)
    camera.lookAt(0, 0, 0)

    rebuildOpenCascadePreviewHandleRoot({
      root,
      previewRoot,
      command: undefined,
      context: {
        argumentsToSubmit: {},
        previewArgumentsToSubmit: {},
      } as never,
      handleState: {
        handles: [
          {
            kind: 'linearDistance',
            argumentName: 'length',
            label: 'Length',
            fallbackAxis: 'smallestExtent',
            color: 0xff00ff,
          },
        ],
        argumentsToSubmit: { length: 8 },
      },
      camera,
      resolvedTheme: 'light',
      getClientSceneScaleFactor: () => 1,
    })

    expect(root.children).toHaveLength(1)
    const handle = root.children[0]
    expect(handle.name).toBe(`${OPEN_CASCADE_PREVIEW_HANDLE_ROOT}:length`)
    expect(handle.visible).toBe(true)
    expect(handle.position.z).toBeGreaterThan(1)

    const line = handle.children.find(
      (child) => child.name === `${OPEN_CASCADE_PREVIEW_HANDLE_ROOT}:stem`
    )
    expect(line).toBeDefined()
    expect(line?.renderOrder).toBe(95)
    const lineMaterial = (
      line as unknown as {
        material: { color: { getHex(): number } }
      }
    ).material
    expect(lineMaterial.color.getHex()).toBe(0xff00ff)

    const visibleMeshes = handle.children.filter(
      (child): child is Mesh =>
        child instanceof Mesh &&
        ((child.material as MeshBasicMaterial).opacity ?? 1) > 0.5
    )
    expect(visibleMeshes.length).toBeGreaterThanOrEqual(2)
    expect(
      visibleMeshes.some(
        (mesh) =>
          (mesh.material as MeshBasicMaterial).color.getHex() === 0xff00ff
      )
    ).toBe(true)

    body.geometry.dispose()
    ;(body.material as MeshBasicMaterial).dispose()
  })

  it('can inject a debug handle independent of command-bar state', () => {
    const root = new Group()
    const previewRoot = new Group()
    previewRoot.add(new Mesh(new BoxGeometry(4, 4, 1), new MeshBasicMaterial()))
    const camera = new PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(10, 10, 10)
    camera.lookAt(0, 0, 0)

    rebuildOpenCascadePreviewHandleDebugRoot({
      root,
      previewRoot,
      camera,
      getClientSceneScaleFactor: () => 1,
    })

    expect(root.children).toHaveLength(1)
    expect(root.children[0].name).toBe(
      `${OPEN_CASCADE_PREVIEW_HANDLE_ROOT}:length`
    )
  })
})
