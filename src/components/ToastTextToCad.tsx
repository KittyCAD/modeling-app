import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { useFileContext } from 'hooks/useFileContext'
import { isTauri } from 'lib/isTauri'
import { PATHS } from 'lib/paths'
import toast from 'react-hot-toast'
import { sep } from '@tauri-apps/api/path'
import { TextToCad_type } from '@kittycad/lib/dist/types/src/models'
import { useEffect, useRef, useState } from 'react'
import { CustomIcon } from './CustomIcon'
import { Box3, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader'
import { base64Decode } from 'lang/wasm'
import { sendTelemetry } from 'lib/textToCad'

const CANVAS_SIZE = 96
const FRUSTUM_SIZE = 0.5
const OUTPUT_KEY = 'source.glb'

export function ToastTextToCad({
  data,
  navigate,
  context,
  token,
}: {
  // TODO: update this type to match the actual data when API is done
  data: TextToCad_type & { fileName: string }
  navigate: (to: string) => void
  context: ReturnType<typeof useFileContext>['context']
  token?: string
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasCopied, setHasCopied] = useState(false)
  const modelId = data.id

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(CANVAS_SIZE, CANVAS_SIZE)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const scene = new Scene()
    const camera = createCamera()
    const loader = new GLTFLoader()
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('/examples/jsm/libs/draco/')
    loader.setDRACOLoader(dracoLoader)
    scene.add(camera)

    // Get the base64 encoded GLB file
    const buffer = base64Decode(data.outputs[OUTPUT_KEY])

    if (buffer instanceof Error) {
      toast.error('Error loading GLB file: ' + buffer.message)
      console.error('decoding buffer from base64 failed', buffer)
      return
    }

    loader.parse(
      buffer,
      '',
      // called when the resource is loaded
      function (gltf) {
        scene.add(gltf.scene)

        // Then we'll calculate the max distance of the bounding box
        // and set that as the camera's position
        const size = new Vector3()
        const boundingBox = new Box3()
        boundingBox.setFromObject(gltf.scene)
        boundingBox.getSize(size)
        const maxDistance = Math.max(size.x, size.y, size.z)

        camera.position.set(maxDistance * 2, maxDistance * 2, maxDistance * 2)
        camera.lookAt(0, 0, 0)
        camera.left = -maxDistance
        camera.right = maxDistance
        camera.top = maxDistance
        camera.bottom = -maxDistance
        camera.near = 0
        camera.far = maxDistance * 10
        camera.updateProjectionMatrix()
        renderer.render(scene, camera)
      },
      // called when loading has errors
      function (error) {
        toast.error('Error loading GLB file: ' + error.message)
        console.error('Error loading GLB file', error)
        return
      }
    )

    // const animate = () => {
    //   const delta = clock.getDelta()
    //   updateCameraOrientation(
    //     camera,
    //     currentQuaternion,
    //     sceneInfra.camControls.camera.quaternion,
    //     delta,
    //     cameraPassiveUpdateTimer
    //   )
    //   renderer.render(scene, camera)
    //   requestAnimationFrame(animate)
    // }
    // animate()

    return () => {
      renderer.dispose()
    }
  }, [])

  return (
    <div className="flex px-4 py-2 gap-4" ref={wrapperRef}>
      <div className="flex-none w-24 h-24">
        <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} />
      </div>
      <div className="flex flex-col items-center gap-4">
        <h2>Text-to-CAD successful</h2>
        <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
          Prompt: "
          {data.prompt.length > 24
            ? data.prompt.slice(0, 24) + '...'
            : data.prompt}
          "
        </p>
        <div className="flex justify-between items-center">
          <button
            name="Reject"
            onClick={() => {
              sendTelemetry(modelId, 'rejected', token)
              toast.dismiss()
            }}
          >
            Reject
          </button>
          {isTauri() ? (
            <button
              className="flex-none p-2"
              name="Accept"
              onClick={() => {
                sendTelemetry(modelId, 'accepted', token)
                navigate(
                  `${PATHS.FILE}/${encodeURIComponent(
                    `${context.project.path}${sep()}${data.fileName}`
                  )}`
                )
                toast.dismiss()
              }}
            >
              Accept
            </button>
          ) : (
            <button
              name="Accept"
              onClick={() => {
                sendTelemetry(modelId, 'accepted', token)
                navigator.clipboard.writeText(data.code || '// no code found')
                setHasCopied(true)
              }}
              className="flex-none p-2 flex items-center gap-2"
            >
              <CustomIcon
                name={hasCopied ? 'clipboardCheckmark' : 'clipboardPlus'}
                className="w-5 h-5"
              />
              {hasCopied ? 'Copied' : 'Copy to clipboard'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const createCamera = (): OrthographicCamera => {
  return new OrthographicCamera(
    -FRUSTUM_SIZE,
    FRUSTUM_SIZE,
    FRUSTUM_SIZE,
    -FRUSTUM_SIZE,
    0.5,
    3
  )
}
