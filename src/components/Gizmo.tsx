import { SceneInfra } from 'clientSideScene/sceneInfra'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function Gizmo() {

  // 1. create canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  
  useEffect(() => {
    if (canvasRef.current) {
      const width = 200
      const height = width

      const canvas = canvasRef.current
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      })
      renderer.setSize(width, height)

      // 2. tiny threejs scene
      const scene = new THREE.Scene()
      const frustum = 0.5
      const camera = new THREE.OrthographicCamera(
        -frustum,
        frustum,
        frustum,
        -frustum,
        0.5,
        3
      )
      camera.position.z = 2

      // 3. create gizmo
      const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5)
      const material = new THREE.MeshNormalMaterial()
      const cube = new THREE.Mesh(geometry, material)
      scene.add(cube)

      // 4. rotation
      const clock = new THREE.Clock()
      const quaternion = SceneInfra.instance.camControls.camera.quaternion
      // 4.1 smoothen rotation with lerp
      let targetQuaternion = new THREE.Quaternion().copy(quaternion)
      let currentQuaternion = new THREE.Quaternion().copy(quaternion)
      function animate() {
        requestAnimationFrame(animate)
        const deltaTime = clock.getDelta()
        const slerpFactor = 1 - Math.exp(-20 * deltaTime) // higher = faster
        targetQuaternion.copy(quaternion)
        currentQuaternion.slerp(targetQuaternion,slerpFactor)
        // 4.2 actual rotation
        cube.quaternion.w = currentQuaternion.w
        cube.quaternion.x = -currentQuaternion.x
        cube.quaternion.y = -currentQuaternion.y
        cube.quaternion.z = -currentQuaternion.z
        renderer.render(scene, camera)
      }
      animate()

      return () => {
        renderer.dispose()
      }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        right: '5px',
        bottom: '50px',
        width: '300px',
        height: '300px',
      }}
    />
  )
}