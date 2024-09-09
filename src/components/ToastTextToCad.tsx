import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useFileContext } from 'hooks/useFileContext'
import { isDesktop } from 'lib/isDesktop'
import { PATHS } from 'lib/paths'
import toast from 'react-hot-toast'
import { TextToCad_type } from '@kittycad/lib/dist/types/src/models'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box3,
  Color,
  DirectionalLight,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader'
import { base64Decode } from 'lang/wasm'
import { sendTelemetry } from 'lib/textToCad'
import { Themes } from 'lib/theme'
import { ActionButton } from './ActionButton'
import { commandBarMachine } from 'machines/commandBarMachine'
import { EventFrom } from 'xstate'
import { fileMachine } from 'machines/fileMachine'

const CANVAS_SIZE = 128
const PROMPT_TRUNCATE_LENGTH = 128
const FRUSTUM_SIZE = 0.5
const OUTPUT_KEY = 'source.glb'

export function ToastTextToCadError({
  toastId,
  message,
  prompt,
  commandBarSend,
}: {
  toastId: string
  message: string
  prompt: string
  commandBarSend: (
    event: EventFrom<typeof commandBarMachine>,
    data?: unknown
  ) => void
}) {
  return (
    <div className="flex flex-col justify-between gap-6">
      <section>
        <h2>Text-to-CAD failed</h2>
        <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
          {message}
        </p>
      </section>
      <div className="flex justify-between gap-8">
        <ActionButton
          Element="button"
          iconStart={{
            icon: 'close',
          }}
          name="Dismiss"
          onClick={() => {
            toast.dismiss(toastId)
          }}
        >
          Dismiss
        </ActionButton>
        <ActionButton
          Element="button"
          iconStart={{
            icon: 'refresh',
          }}
          name="Edit prompt"
          onClick={() => {
            commandBarSend({
              type: 'Find and select command',
              data: {
                groupId: 'modeling',
                name: 'Text-to-CAD',
                argDefaultValues: {
                  prompt,
                },
              },
            })
            toast.dismiss(toastId)
          }}
        >
          Edit prompt
        </ActionButton>
      </div>
    </div>
  )
}

export function ToastTextToCadSuccess({
  toastId,
  data,
  navigate,
  context,
  token,
  fileMachineSend,
  settings,
}: {
  toastId: string
  data: TextToCad_type & { fileName: string }
  navigate: (to: string) => void
  context: ReturnType<typeof useFileContext>['context']
  token?: string
  fileMachineSend: (
    event: EventFrom<typeof fileMachine>,
    data?: unknown
  ) => void
  settings: {
    theme: Themes
    highlightEdges: boolean
  }
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRequestRef = useRef<number>()
  const [hasCopied, setHasCopied] = useState(false)
  const [showCopiedUi, setShowCopiedUi] = useState(false)
  const modelId = data.id

  const animate = useCallback(
    ({
      renderer,
      scene,
      camera,
      controls,
      isFirstRender = false,
    }: {
      renderer: WebGLRenderer
      scene: Scene
      camera: OrthographicCamera
      controls: OrbitControls
      isFirstRender?: boolean
    }) => {
      if (
        !wrapperRef.current ||
        !(isFirstRender || animationRequestRef.current)
      )
        return
      animationRequestRef.current = requestAnimationFrame(() =>
        animate({ renderer, scene, camera, controls })
      )
      // required if controls.enableDamping or controls.autoRotate are set to true
      controls.update()
      renderer.render(scene, camera)
    },
    []
  )

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(CANVAS_SIZE, CANVAS_SIZE)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const scene = new Scene()
    const ambientLight = new DirectionalLight(new Color('white'), 8.0)
    scene.add(ambientLight)
    const camera = createCamera()
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
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

        // Style the objects in the scene
        traverseSceneToStyleObjects({
          scene,
          ...settings,
        })

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

        // Create and attach the lights,
        // since their position depends on the bounding box
        const cameraLight1 = new DirectionalLight(new Color('white'), 1)
        cameraLight1.position.set(maxDistance * -5, -maxDistance, maxDistance)
        camera.add(cameraLight1)

        const cameraLight2 = new DirectionalLight(new Color('white'), 1.4)
        cameraLight2.position.set(0, 0, 2 * maxDistance)
        camera.add(cameraLight2)

        const sceneLight = new DirectionalLight(new Color('white'), 1)
        sceneLight.position.set(
          -2 * maxDistance,
          -2 * maxDistance,
          2 * maxDistance
        )
        scene.add(sceneLight)

        camera.updateProjectionMatrix()
        controls.update()
        // render the scene once...
        renderer.render(scene, camera)
      },
      // called when loading has errors
      function (error) {
        toast.error('Error loading GLB file: ' + error.message)
        console.error('Error loading GLB file', error)
        return
      }
    )

    // ...and set a mouseover listener on the canvas to enable the orbit controls
    canvasRef.current.addEventListener('mouseover', () => {
      renderer.setAnimationLoop(() =>
        animate({ renderer, scene, camera, controls, isFirstRender: true })
      )
    })
    canvasRef.current.addEventListener('mouseout', () => {
      renderer.setAnimationLoop(null)
      if (animationRequestRef.current) {
        cancelAnimationFrame(animationRequestRef.current)
        animationRequestRef.current = undefined
      }
    })

    return () => {
      renderer.dispose()
      if (animationRequestRef.current) {
        cancelAnimationFrame(animationRequestRef.current)
        animationRequestRef.current = undefined
      }
    }
  }, [])

  return (
    <div className="flex gap-4 min-w-80" ref={wrapperRef}>
      <div
        className="flex-none overflow-hidden"
        style={{ width: CANVAS_SIZE + 'px', height: CANVAS_SIZE + 'px' }}
      >
        <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} />
      </div>
      <div className="flex flex-col justify-between gap-6">
        <section>
          <h2>Text-to-CAD successful</h2>
          <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
            Prompt: "
            {data.prompt.length > PROMPT_TRUNCATE_LENGTH
              ? data.prompt.slice(0, PROMPT_TRUNCATE_LENGTH) + '...'
              : data.prompt}
            "
          </p>
        </section>
        <div className="flex justify-between gap-8">
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'close',
            }}
            data-negative-button={hasCopied ? 'close' : 'reject'}
            name={hasCopied ? 'Close' : 'Reject'}
            onClick={() => {
              if (!hasCopied) {
                sendTelemetry(modelId, 'rejected', token)
              }
              if (isDesktop()) {
                // Delete the file from the project
                fileMachineSend({
                  type: 'Delete file',
                  data: {
                    name: data.fileName,
                    path: `${context.project.path}${window.electron.sep}${data.fileName}`,
                    children: null,
                  },
                })
              }
              toast.dismiss(toastId)
            }}
          >
            {hasCopied ? 'Close' : 'Reject'}
          </ActionButton>
          {isDesktop() ? (
            <ActionButton
              Element="button"
              iconStart={{
                icon: 'checkmark',
              }}
              name="Accept"
              onClick={() => {
                sendTelemetry(modelId, 'accepted', token)
                navigate(
                  `${PATHS.FILE}/${encodeURIComponent(
                    `${context.project.path}${window.electron.sep}${data.fileName}`
                  )}`
                )
                toast.dismiss(toastId)
              }}
            >
              Accept
            </ActionButton>
          ) : (
            <ActionButton
              Element="button"
              iconStart={{
                icon: showCopiedUi ? 'clipboardCheckmark' : 'clipboardPlus',
              }}
              name="Copy to clipboard"
              onClick={() => {
                sendTelemetry(modelId, 'accepted', token)
                navigator.clipboard.writeText(data.code || '// no code found')
                setShowCopiedUi(true)
                setHasCopied(true)

                // Reset the button text after 5 seconds
                setTimeout(() => {
                  setShowCopiedUi(false)
                }, 5000)
              }}
            >
              {showCopiedUi ? 'Copied' : 'Copy to clipboard'}
            </ActionButton>
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

function traverseSceneToStyleObjects({
  scene,
  color = 0x29ffa4,
  highlightEdges = false,
}: {
  scene: Scene
  color?: number
  theme: Themes
  highlightEdges?: boolean
}) {
  scene.traverse((child) => {
    if ('isMesh' in child && child.isMesh) {
      // Replace the material with our flat color one
      ;(child as Mesh).material = new MeshBasicMaterial({
        color,
      })

      // Add edges to the mesh if the option is enabled
      if (!highlightEdges) return
      const edges = new EdgesGeometry((child as Mesh).geometry, 30)
      const lines = new LineSegments(
        edges,
        new LineBasicMaterial({
          // We don't respect the theme here on purpose,
          // because I found the dark edges to work better
          // in light and dark themes,
          // but we can change that if needed, it is wired up
          color: 0x1f2020,
        })
      )
      scene.add(lines)
    }
  })
}
