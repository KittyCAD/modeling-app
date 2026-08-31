import {
  type Group,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import type { PlaneFrame } from '@src/contracts/sceneProjection'
import {
  resizeLines,
  scalePoints,
} from '@src/features/sketchOverlay/sketchSegments'
import type { CameraFrame } from '@src/lib/scene/projection'
import { halfViewHeight, normalize, viewBasis } from '@src/lib/scene/projection'

/**
 * A THREE scene drawn over the engine's video, in the engine's own space.
 *
 * This is the part of the existing app's `sceneInfra` that a sketch actually
 * needs: a transparent canvas, a camera that agrees with the remote one, and a
 * group placed on the sketch plane so everything inside it can be drawn in the
 * sketch's own two dimensions.
 *
 * The camera is built from `viewBasis` and `halfViewHeight` — the same two
 * functions the projection uses — rather than from the existing app's
 * `ORTHOGRAPHIC_CAMERA_SIZE` arithmetic. That is the one deliberate departure,
 * and it is the safer one: sharing the functions means the THREE camera and
 * anything else placed from the same frame cannot disagree, whereas a second
 * derivation of the same frustum is a second thing to keep correct.
 *
 * What it does *not* do is drive the camera. The engine reports where its camera
 * is and this follows, so the overlay is as fresh as the last echo and no
 * fresher — the same trade the SVG overlay made, and the reason porting the
 * renderer changes how sketch mode looks without changing how it tracks. Taking
 * the camera, as the existing app does on entering a sketch, is a separate
 * change.
 */

/** Where the sketch's geometry lives, so a renderer can find it. */
export const SKETCH_GROUP = 'sketch'

export interface SketchScene {
  readonly scene: Scene
  /** The group placed on the sketch plane. Draw in plane coordinates inside it. */
  readonly group: Group
  /** Ask for a frame. Renders once, on the next animation frame. */
  invalidate: () => void
  /** Point the camera at what the engine says it is looking at. */
  follow: (frame: CameraFrame) => void
  /** Put the group on a plane, in millimetres. */
  placeOn: (plane: PlaneFrame) => void
  /** World units per CSS pixel, for anything that must keep a constant size. */
  scaleFactor: () => number
  /** The canvas size, which the line materials need. */
  viewport: () => { width: number; height: number }
  /**
   * Size the points for the current camera.
   *
   * Freshly built points are unit circles, so whatever built them has to ask —
   * and the camera does the same on every echo, which is the cheap path that
   * avoids rebuilding geometry to move a point by a fraction of a millimetre.
   */
  rescale: () => void
  resize: () => void
  dispose: () => void
}

export function createSketchScene(
  host: HTMLElement,
  group: Group
): SketchScene {
  const scene = new Scene()
  // Transparent: the model is behind this, rendered somewhere else entirely.
  scene.background = null
  scene.add(group)
  group.name = SKETCH_GROUP

  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.style.position = 'absolute'
  renderer.domElement.style.inset = '0'
  renderer.domElement.style.inlineSize = '100%'
  renderer.domElement.style.blockSize = '100%'
  // The canvas draws; the surface underneath takes the pointer.
  renderer.domElement.style.pointerEvents = 'none'
  host.appendChild(renderer.domElement)

  /**
   * A second renderer for DOM labels.
   *
   * Constraint badges and dimension values want to be HTML — real text with real
   * fonts, and eventually real buttons — positioned by the same camera as the
   * geometry. `CSS2DRenderer` is what the existing app uses for exactly this, and
   * it is here now so that the layer exists before anything needs it.
   */
  const labels = new CSS2DRenderer()
  labels.domElement.style.position = 'absolute'
  labels.domElement.style.inset = '0'
  labels.domElement.style.pointerEvents = 'none'
  host.appendChild(labels.domElement)

  /*
   * Two cameras, kept because the engine switches between the two projections and
   * a camera cannot change which it is. Whichever matches the last frame is the
   * one rendered with.
   */
  const orthographic = new OrthographicCamera()
  const perspective = new PerspectiveCamera()
  let camera: OrthographicCamera | PerspectiveCamera = orthographic

  /** World units per pixel, from the last frame followed. */
  let unitsPerPixel = 1

  let frame: number | null = null
  let pending = false

  const size = () => ({
    width: host.clientWidth,
    height: host.clientHeight,
  })

  const draw = () => {
    frame = null
    if (!pending) return
    pending = false

    renderer.render(scene, camera)
    labels.render(scene, camera)
  }

  const invalidate = () => {
    pending = true
    if (frame === null) frame = requestAnimationFrame(draw)
  }

  const resize = () => {
    const { width, height } = size()
    if (width === 0 || height === 0) return

    renderer.setPixelRatio(window.devicePixelRatio)
    // `false` so the canvas keeps the CSS size the stylesheet gave it and only
    // its backing resolution changes.
    renderer.setSize(width, height, false)
    labels.setSize(width, height)
    invalidate()
  }

  return {
    scene,
    group,
    invalidate,
    resize,

    follow(next: CameraFrame) {
      const { width, height } = size()
      if (width === 0 || height === 0) return

      const basis = viewBasis(next)
      const aspect = width / height

      // A camera's own Z points backwards, away from what it is looking at.
      const rotation = new Quaternion().setFromRotationMatrix(
        new Matrix4().makeBasis(
          new Vector3(basis.right.x, basis.right.y, basis.right.z),
          new Vector3(basis.up.x, basis.up.y, basis.up.z),
          new Vector3(-basis.forward.x, -basis.forward.y, -basis.forward.z)
        )
      )

      /*
       * The distance the engine's own view height is measured at.
       *
       * Under perspective the height grows with depth, so the frustum is stated
       * as an angle and THREE does the rest; under orthographic it is fixed by
       * how far the camera was pulled back, which is what `halfViewHeight`
       * computes from the vantage and the centre.
       */
      const eye = new Vector3(next.position.x, next.position.y, next.position.z)
      const target = new Vector3(next.target.x, next.target.y, next.target.z)
      const distance = eye.distanceTo(target)

      if (next.orthographic) {
        const halfHeight = halfViewHeight(next, distance)
        orthographic.left = -halfHeight * aspect
        orthographic.right = halfHeight * aspect
        orthographic.top = halfHeight
        orthographic.bottom = -halfHeight
        // Near and far around the target, generously: a sketch plane can be
        // anywhere in the model and clipping it would be invisible until it
        // happened.
        orthographic.near = -distance * 100 - 1
        orthographic.far = distance * 100 + 1
        orthographic.zoom = 1
        orthographic.updateProjectionMatrix()
        camera = orthographic
        unitsPerPixel = (halfHeight * 2) / height
      } else {
        perspective.fov = next.fovY
        perspective.aspect = aspect
        perspective.near = Math.max(0.01, distance / 1000)
        perspective.far = distance * 100 + 1
        perspective.updateProjectionMatrix()
        camera = perspective
        unitsPerPixel = (halfViewHeight(next, distance) * 2) / height
      }

      camera.position.copy(eye)
      camera.quaternion.copy(rotation)
      camera.updateMatrixWorld()

      // A pixel is a different size now, so anything sized in pixels has moved.
      scalePoints(group, unitsPerPixel)
      invalidate()
    },

    placeOn(plane: PlaneFrame) {
      /*
       * The plane's frame as a transform.
       *
       * Everything inside the group is then drawn in the sketch's own
       * coordinates — `(x, y, 0)` — which is what makes the segment builders
       * portable: they are the existing app's, and its sketch group is placed the
       * same way.
       */
      const x = normalize(plane.xAxis)
      const y = normalize(plane.yAxis)
      const z = normalize(plane.zAxis)

      group.matrixAutoUpdate = false
      group.matrix.makeBasis(
        new Vector3(x.x, x.y, x.z),
        new Vector3(y.x, y.y, y.z),
        new Vector3(z.x, z.y, z.z)
      )
      group.matrix.setPosition(plane.origin.x, plane.origin.y, plane.origin.z)
      group.matrixWorldNeedsUpdate = true

      invalidate()
    },

    scaleFactor: () => unitsPerPixel,
    viewport: size,
    rescale: () => {
      scalePoints(group, unitsPerPixel)
      invalidate()
    },

    dispose() {
      if (frame !== null) cancelAnimationFrame(frame)
      renderer.domElement.remove()
      labels.domElement.remove()
      renderer.forceContextLoss()
      renderer.dispose()
    },
  }
}
