import { SceneInfra } from 'clientSideScene/sceneInfra'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function Gizmo() {

  // 1. Canvas and Scene
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  
  useEffect(() => {
    if (canvasRef.current) {

      const canvas = canvasRef.current
      const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true})
      const canvasWidth = 80
      const canvasHeight = canvasWidth
      renderer.setSize(canvasWidth, canvasHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      const scene = new THREE.Scene()      

      // 2. Gizmo
      // 2.1 Main axis 
      const axisLength = 0.35
      const axisWidth = 0.02
      const axisGeometry = new THREE.BoxGeometry(axisLength, axisWidth, axisWidth)
        .translate(axisLength/2,0,0)
      
      const colorC = new THREE.Color( '#b0cbff' )
      const colorX = new THREE.Color( '#fa6668' )
      const colorY = new THREE.Color( '#11eb6b' )
      const colorZ = new THREE.Color( '#6689ef' )
      const colorG = new THREE.Color( '#c6c7c2' )

      const materialX = new THREE.MeshBasicMaterial({ color: colorX })
      const materialY = new THREE.MeshBasicMaterial({ color: colorY })
      const materialZ = new THREE.MeshBasicMaterial({ color: colorZ })
      const materialG = new THREE.MeshBasicMaterial({ color: colorG })
      
      const axisX = new THREE.Mesh(axisGeometry, materialX)
      const axisY = new THREE.Mesh(axisGeometry, materialY)
      const axisZ = new THREE.Mesh(axisGeometry, materialZ)

      axisY.rotation.z = Math.PI / 2
		  axisZ.rotation.y = - Math.PI / 2
      scene.add(axisX,axisY,axisZ)

      // 2.2 gray axis
      const axisXg = new THREE.Mesh(axisGeometry, materialG)
      const axisYg = new THREE.Mesh(axisGeometry, materialG)
      const axisZg = new THREE.Mesh(axisGeometry, materialG)

      axisXg.rotation.z = Math.PI
      axisYg.rotation.z = - Math.PI / 2
		  axisZg.rotation.y = Math.PI / 2
      scene.add( axisXg, axisYg, axisZg )

      // 2.3 main axis heads
      const axisHeadGeometry = new THREE.SphereGeometry(0.065,16,8).translate(axisLength,0,0)

      const axisHeadX = new THREE.Mesh(axisHeadGeometry, materialX)
      const axisHeadY = new THREE.Mesh(axisHeadGeometry, materialY)
      const axisHeadZ = new THREE.Mesh(axisHeadGeometry, materialZ)

      axisHeadY.rotation.z = Math.PI / 2
		  axisHeadZ.rotation.y = - Math.PI / 2
      scene.add( axisHeadX, axisHeadY, axisHeadZ )

      // 2.4 gray axis heads
      const axisHeadXg = new THREE.Mesh(axisHeadGeometry, materialG)
      const axisHeadYg = new THREE.Mesh(axisHeadGeometry, materialG)
      const axisHeadZg = new THREE.Mesh(axisHeadGeometry, materialG)

      axisHeadXg.rotation.z = Math.PI
      axisHeadYg.rotation.z = - Math.PI / 2
		  axisHeadZg.rotation.y = Math.PI / 2
      scene.add( axisHeadXg, axisHeadYg, axisHeadZg )

      // 4. Camera
      const fr = 0.5
      const camera = new THREE.OrthographicCamera( -fr, fr, fr, -fr, 0.5, 3)

      const clientCamera = SceneInfra.instance.camControls.camera
      const quaternion = clientCamera.quaternion
      
      // 4.1 smooth rotation with lerp
      let targetQuaternion = new THREE.Quaternion().copy(quaternion)
      let currentQuaternion = new THREE.Quaternion().copy(quaternion)

      const clock = new THREE.Clock()

      function animate() {
        requestAnimationFrame(animate)
        const deltaTime = clock.getDelta()

        const slerpFactor = 1 - Math.exp(-30 * deltaTime) // higher = faster
        targetQuaternion.copy(quaternion)
        currentQuaternion.slerp(targetQuaternion,slerpFactor)
        currentQuaternion.normalize()

        // 4.2 Update camera position and orientation
        camera.position.set( 0, 0, 1 ).applyQuaternion( currentQuaternion )
        camera.quaternion.copy( currentQuaternion ) 

        renderer.render(scene, camera)
      }
      animate()

      return () => {
        renderer.dispose()
      }
    }
  }, [])

  return (
    <div
      className="grid place-content-center rounded-full overflow-hidden border border-solid border-primary/50"
      style={{ position: 'fixed', right: '20px', bottom: '50px' }}
    >
      <canvas ref={canvasRef} />
    </div>
  )
}