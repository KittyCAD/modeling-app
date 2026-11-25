import { SELECTION_INDEX_ATTRIBUTE } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { IntegerIdPicker } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import {
  InstancedBufferAttribute,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
} from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { Line2NodeMaterial, WebGPURenderer } from 'three/webgpu'

export async function createEdgePickingScene() {
  const size = 64
  const renderer = new WebGPURenderer()
  await renderer.init()
  renderer.setPixelRatio(2)
  renderer.setSize(size, size)
  document.body.appendChild(renderer.domElement)

  // One world unit per CSS pixel; world +Y points up from the bottom of the canvas.
  const camera = new OrthographicCamera(0, size, size, 0, 0.1, 10)
  camera.position.z = 5
  camera.updateMatrixWorld()
  const face = new Mesh(new PlaneGeometry(size, size))
  face.position.set(size / 2, size / 2, 0)
  face.name = 'face'

  const material = new Line2NodeMaterial()
  const line = (name: string, x: number) => {
    const geometry = new LineSegmentsGeometry().setPositions([
      x,
      size - 12,
      1,
      x,
      size - 44,
      1,
    ])
    geometry.setAttribute(
      SELECTION_INDEX_ATTRIBUTE,
      new InstancedBufferAttribute(Uint32Array.of(1), 1)
    )
    const source = new LineSegments2(geometry, material)
    source.name = name
    return {
      source,
      targets: [
        { object: source, ranges: [{ firstSegment: 0, segmentCount: 1 }] },
      ],
    }
  }
  const picker = new IntegerIdPicker(renderer)
  picker.setTargets(
    [face],
    null,
    line('body edge', 24),
    line('sketch line', 32)
  )

  return async ([x, y]: [number, number]) => {
    const hit = await picker.pick({
      x,
      y,
      streamWidth: size,
      streamHeight: size,
      camera,
    })
    return hit?.target?.name
  }
}
