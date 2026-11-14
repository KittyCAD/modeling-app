import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { afterEach, expect, it, vi } from 'vitest'
import { EntityStylingRenderer } from '@src/clientSideScene/localRenderer/EntityStylingRenderer'
import type { EntityStyle } from '@src/lib/scene/entityStyling'
import {
  BoxGeometry,
  type Color,
  Group,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PerspectiveCamera,
  SRGBColorSpace,
  type Scene,
  type Vector2,
} from 'three'
import {
  RenderPipeline,
  QuadMesh,
  Line2NodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu'

afterEach(() => vi.restoreAllMocks())
const style: EntityStyle = {
  color: [0.2, 0.5, 0.8],
  fillOpacity: 0.05,
  outlineOpacity: 0.3,
  lineWidth: 1,
  priority: 1,
}
function setup() {
  const draws: Mesh[][] = []
  const composites: unknown[] = []
  vi.spyOn(RenderPipeline.prototype, 'render').mockImplementation(() => {})
  vi.spyOn(QuadMesh.prototype, 'render').mockImplementation(function (
    this: QuadMesh
  ) {
    composites.push(this.material)
  })
  const renderer = {
    samples: 0,
    toneMapping: NoToneMapping,
    outputColorSpace: SRGBColorSpace,
    autoClear: true,
    getOutputBufferType: () => HalfFloatType,
    getDrawingBufferSize: (size: Vector2) => size.set(100, 100),
    getRenderTarget: () => null,
    getClearColor: (color: Color) => color.set(0),
    getClearAlpha: () => 1,
    setClearColor: () => {},
    setRenderTarget: () => {},
    clear: () => {},
    render: (scene: Scene) => draws.push([...scene.children] as Mesh[]),
  }
  const styling = new EntityStylingRenderer(
    renderer as unknown as WebGPURenderer,
    '#ffffff'
  )
  const first = new Mesh(new BoxGeometry(), new MeshBasicMaterial()),
    second = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  styling.setTargets([first, second])
  return {
    styling,
    first,
    second,
    draws,
    composites,
    draw: () => {
      draws.length = 0
      styling.beginFrame(false)
      styling.render(new PerspectiveCamera())
      return draws.map((objects) => objects.map((object) => object.geometry))
    },
  }
}
it('lets the highest priority style win an overlap and reveals the lower layer when that group clears', () => {
  const { styling, first, second, draw } = setup()
  try {
    const low = Symbol(),
      high = Symbol()
    styling.setGroup(low, [first, second], style)
    styling.setGroup(high, [second], { ...style, priority: 100 })
    expect(draw()).toEqual([[first.geometry], [second.geometry]])
    styling.clearGroup(high)
    expect(draw()).toEqual([[first.geometry, second.geometry]])
    styling.clearGroup(low)
    expect(draw()).toEqual([])
  } finally {
    styling.dispose()
  }
})
it('keeps equal-priority ownership stable across appearance changes and never disposes borrowed geometry', () => {
  const { styling, first, draw, composites } = setup()
  const geometryDisposed = vi.spyOn(first.geometry, 'dispose')
  try {
    const a = Symbol(),
      b = Symbol()
    styling.setGroup(a, [first], style)
    styling.setGroup(b, [first], { ...style, outlineOpacity: 0.2 })
    draw()
    const winner = composites.at(-1)
    styling.setGroup(a, [first], { ...style, fillOpacity: 0.1 })
    expect(draw()).toEqual([[first.geometry]])
    expect(composites.at(-1)).toBe(winner)
    styling.clearGroup(b)
    expect(draw()).toEqual([[first.geometry]])
    styling.clearModel()
    expect(draw()).toEqual([])
    expect(geometryDisposed).not.toHaveBeenCalled()
  } finally {
    styling.dispose()
  }
})
it('does not reveal geometry hidden by a source ancestor', () => {
  const { styling, first, draw, draws } = setup()
  try {
    const parent = new Group()
    parent.add(first)
    parent.visible = false
    styling.setGroup(Symbol(), [first], style)
    draw()
    expect(draws[0][0].visible).toBe(false)
    parent.visible = true
    draw()
    expect(draws[0][0].visible).toBe(true)
  } finally {
    styling.dispose()
  }
})

it('uses outline opacity and screen-pixel width for rendered curve targets', () => {
  const { styling, draw, draws } = setup()
  const geometry = new LineSegmentsGeometry().setPositions([0, 0, 0, 1, 0, 0])
  const sourceMaterial = new Line2NodeMaterial(),
    line = new LineSegments2(geometry, sourceMaterial)
  try {
    styling.setTargets([line])
    styling.setGroup(Symbol(), [line], {
      ...style,
      fillOpacity: 0,
      outlineOpacity: 0.4,
      lineWidth: 3,
    })
    expect(draw()).toEqual([[geometry]])
    const material = draws[0][0].material as Line2NodeMaterial
    expect(material.opacity).toBe(0.4)
    expect(material.linewidth).toBe(3)
    expect(material.transparent).toBe(true)
  } finally {
    styling.dispose()
    sourceMaterial.dispose()
    geometry.dispose()
  }
})
