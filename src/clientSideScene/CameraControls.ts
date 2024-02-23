import {
  // EventDispatcher,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Spherical,
  Vector2,
  Vector3,
} from 'three'

const ORTHOGRAPHIC_CAMERA_SIZE = 20

interface Callbacks {
  onCameraChange?: () => void
}

export class CameraControls {
  camera: PerspectiveCamera | OrthographicCamera
  target: Vector3
  domElement: HTMLCanvasElement
  isDragging: boolean
  mouseDownPosition: Vector2
  mouseNewPosition: Vector2
  rotationSpeed = 0.3
  pendingZoom: number | null = null
  pendingRotation: Vector2 | null = null
  callbacks: Callbacks

  constructor(
    isOrtho = false,
    domElement: HTMLCanvasElement,
    callbacks: Callbacks
  ) {
    this.callbacks = callbacks
    this.camera = isOrtho ? new OrthographicCamera() : new PerspectiveCamera()
    this.camera.up.set(0, 0, 1)
    this.camera.far = 20000
    this.target = new Vector3()
    this.domElement = domElement
    this.isDragging = false
    this.mouseDownPosition = new Vector2()
    this.mouseNewPosition = new Vector2()

    this.domElement.addEventListener('mousedown', this.onMouseDown)
    this.domElement.addEventListener('mousemove', this.onMouseMove)
    this.domElement.addEventListener('mouseup', this.onMouseUp)
    this.domElement.addEventListener('wheel', this.onMouseWheel)

    window.addEventListener('resize', this.onWindowResize)
    this.onWindowResize()

    this.update()
  }

  onWindowResize = () => {
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = window.innerWidth / window.innerHeight
    } else if (this.camera instanceof OrthographicCamera) {
      const aspect = window.innerWidth / window.innerHeight
      this.camera.left = -ORTHOGRAPHIC_CAMERA_SIZE * aspect
      this.camera.right = ORTHOGRAPHIC_CAMERA_SIZE * aspect
      this.camera.top = ORTHOGRAPHIC_CAMERA_SIZE
      this.camera.bottom = -ORTHOGRAPHIC_CAMERA_SIZE
    }
    this.camera.updateProjectionMatrix()
  }

  onMouseDown = (event: MouseEvent) => {
    this.isDragging = true
    this.mouseDownPosition.set(event.clientX, event.clientY)
  }

  onMouseMove = (event: MouseEvent) => {
    // console.log('mouse move', event)
    if (this.isDragging) {
      this.mouseNewPosition.set(event.clientX, event.clientY)
      const deltaMove = this.mouseNewPosition
        .clone()
        .sub(this.mouseDownPosition)
      this.mouseDownPosition.copy(this.mouseNewPosition)

      // Implement camera movement logic here based on deltaMove
      // For example, for rotating the camera around the target:
      this.pendingRotation = this.pendingRotation
        ? this.pendingRotation
        : new Vector2()
      this.pendingRotation.x += deltaMove.x
      this.pendingRotation.y += deltaMove.y
    }
  }

  onMouseUp = (event: MouseEvent) => {
    this.isDragging = false
  }

  onMouseWheel = (event: WheelEvent) => {
    this.pendingZoom = this.pendingZoom ? this.pendingZoom : 1
    const zoomSpeed = 0.1
    this.pendingZoom *= 1 + (event.deltaY > 0 ? zoomSpeed : -zoomSpeed)
  }

  update = () => {
    // If there are any changes that need to be applied to the camera, apply them here.
    // This could include rotations, panning, zooming, etc.

    // For example, if you have a pending rotation that needs to be applied:
    let didChange = false
    if (this.pendingRotation) {
      this.rotateCamera(this.pendingRotation.x, this.pendingRotation.y)
      this.pendingRotation = null // Clear the pending rotation after applying it
      didChange = true
    }

    // // If you have a zoom level that needs to be applied:
    if (this.pendingZoom) {
      if (this.camera instanceof PerspectiveCamera) {
        // move camera towards or away from the target
        const distance = this.camera.position.distanceTo(this.target)
        const newDistance = distance * this.pendingZoom
        const direction = this.camera.position
          .clone()
          .sub(this.target)
          .normalize()
        const newPosition = this.target
          .clone()
          .add(direction.multiplyScalar(newDistance))
        this.camera.position.copy(newPosition)

        this.camera.updateProjectionMatrix()
        this.pendingZoom = null // Clear the pending zoom after applying it
      } else {
        // TODO change ortho zoom
      }
      didChange = true
    }

    // Always look at the target
    // TODO, we might need to implement this if it doesn't respect z-up
    // most importantly when it's looking straight up or down as that's gimbal lock situation
    this.camera.lookAt(this.target)

    // Update the camera's matrices
    this.camera.updateMatrixWorld()
    if (didChange) {
      this.callbacks.onCameraChange?.()
    }

    // If you're using damping or easing, you would apply it here as well
    // This would typically involve interpolating between the current camera state and the desired state
  }

  // Additional methods for camera manipulation can be added here
  // For example, rotateCamera, zoomCamera, etc.
  rotateCamera = (deltaX: number, deltaY: number) => {
    const quat = new Quaternion().setFromUnitVectors(
      new Vector3(0, 0, 1),
      new Vector3(0, 1, 0)
    )
    const quatInverse = quat.clone().invert()

    const angleX = deltaX * this.rotationSpeed // rotationSpeed is a constant that defines how fast the camera rotates
    const angleY = deltaY * this.rotationSpeed

    // Convert angles to radians
    const radianX = MathUtils.degToRad(angleX)
    const radianY = MathUtils.degToRad(angleY)

    // Get the offset from the camera to the target
    const offset = new Vector3().subVectors(this.camera.position, this.target)

    // spherical is a y-up paradigm, need to conform to that for now
    offset.applyQuaternion(quat)

    // Convert offset to spherical coordinates
    const spherical = new Spherical().setFromVector3(offset)

    // Apply the rotations
    spherical.theta -= radianX
    spherical.phi -= radianY

    // Restrict the phi angle to avoid the camera flipping at the poles
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi))

    // Convert back to Cartesian coordinates
    offset.setFromSpherical(spherical)

    // put the offset back into the z-up paradigm
    offset.applyQuaternion(quatInverse)

    // Update the camera's position
    this.camera.position.copy(this.target).add(offset)

    // Look at the target
    this.camera.lookAt(this.target)

    this.camera.up.set(0, 0, 1)
    this.camera.updateMatrixWorld()
  }
}
