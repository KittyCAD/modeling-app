import { Popover, Transition } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { letEngineAnimateAndSyncCamAfter } from '@src/clientSideScene/CameraControls'
import { useViewControlMenuItems } from '@src/components/ViewControlMenu'
import AxisGizmo from '@src/components/gizmo/AxisGizmo'
import CubeGizmo from '@src/components/gizmo/CubeGizmo'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import { isReducedMotion } from '@src/lib/utils'
import { useCallback, useEffect, useState } from 'react'
import { Vector3 } from 'three'

const NORMAL_TO_SKETCH_DOT_TOLERANCE = Math.cos((0.5 * Math.PI) / 180)
const CLIENT_SCENE_FADE_DURATION_MS = 300
const ORIENT_TO_SKETCH_FADE_DURATION_MS = 200

export default function Gizmo() {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { state: modelingState } = useModelingContext()
  const menuItems = useViewControlMenuItems()
  const settingsValues = settings.useSettings()
  const gizmoType = settingsValues.modeling.gizmoType.current
  const inSketchMode = modelingState.matches('sketchSolveMode')
  const sketchSolveInit = modelingState.context.sketchSolveInit
  const targetId =
    sketchSolveInit?.type === 'extrudeFace'
      ? sketchSolveInit.faceId
      : sketchSolveInit?.planeId
  const [isNormalToSketch, setIsNormalToSketch] = useState(true)
  const [isAnimatingToSketch, setIsAnimatingToSketch] = useState(false)

  const getIsNormalToSketch = useCallback(() => {
    if (!sketchSolveInit) {
      return true
    }
    const cameraDirection = kclManager.sceneInfra.camControls.camera
      .getWorldDirection(new Vector3())
      .normalize()
    const sketchNormal = new Vector3(...sketchSolveInit.zAxis).normalize()
    return (
      Math.abs(cameraDirection.dot(sketchNormal)) >=
      NORMAL_TO_SKETCH_DOT_TOLERANCE
    )
  }, [kclManager.sceneInfra.camControls.camera, sketchSolveInit])

  const updateIsNormalToSketch = useCallback(() => {
    setIsNormalToSketch(getIsNormalToSketch())
  }, [getIsNormalToSketch])

  useEffect(() => {
    const cameraChange = kclManager.sceneInfra.camControls.cameraChange
    updateIsNormalToSketch()
    cameraChange.add(updateIsNormalToSketch)
    return () => cameraChange.remove(updateIsNormalToSketch)
  }, [kclManager.sceneInfra.camControls.cameraChange, updateIsNormalToSketch])

  const animateNormalToSketch = useCallback(async () => {
    if (!targetId || isAnimatingToSketch) return

    const camControls = kclManager.sceneInfra.camControls
    const shouldFade = !isReducedMotion()
    const previousInteractionState = {
      enablePan: camControls.enablePan,
      enableRotate: camControls.enableRotate,
      enableZoom: camControls.enableZoom,
    }
    setIsAnimatingToSketch(true)
    camControls.enablePan = false
    camControls.enableRotate = false
    camControls.enableZoom = false

    try {
      if (shouldFade) {
        camControls.setEngineCameraAnimationInProgress(true)
        await new Promise((resolve) =>
          setTimeout(resolve, CLIENT_SCENE_FADE_DURATION_MS)
        )
      }

      await letEngineAnimateAndSyncCamAfter(
        kclManager.engineCommandManager,
        targetId
      )
    } finally {
      camControls.enablePan = previousInteractionState.enablePan
      camControls.enableRotate = previousInteractionState.enableRotate
      camControls.enableZoom = previousInteractionState.enableZoom
      if (shouldFade) camControls.setEngineCameraAnimationInProgress(false)
      const isNowNormalToSketch = getIsNormalToSketch()
      setIsNormalToSketch(isNowNormalToSketch)
      if (isNowNormalToSketch) {
        setTimeout(
          () => setIsAnimatingToSketch(false),
          ORIENT_TO_SKETCH_FADE_DURATION_MS
        )
      } else {
        setIsAnimatingToSketch(false)
      }
    }
  }, [getIsNormalToSketch, isAnimatingToSketch, kclManager, targetId])

  return (
    <div className="relative">
      <Transition
        show={inSketchMode && !isNormalToSketch && Boolean(targetId)}
        enter="transition-opacity duration-200"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-200"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <button
          type="button"
          className="pointer-events-auto absolute right-0 bottom-full mb-2 whitespace-nowrap px-2 py-1 text-xs"
          disabled={isAnimatingToSketch}
          onClick={() => {
            animateNormalToSketch().catch(reportRejection)
          }}
        >
          Orient to Sketch
        </button>
      </Transition>
      <div className="relative">
        {gizmoType === 'axis' ? <AxisGizmo /> : <CubeGizmo />}
        <GizmoDropdown items={menuItems} />
      </div>
    </div>
  )
}

function GizmoDropdown({ items }: { items: React.ReactNode[] }) {
  return (
    <Popover className="absolute top-0 right-0 pointer-events-auto">
      {(popover) => (
        <>
          <Popover.Button className="border-none p-0 m-0 -translate-y-1/4 translate-x-1/4">
            <CustomIcon
              name="caretDown"
              className="w-4 h-4 ui-open:rotate-180"
            />
            <span className="sr-only">View settings</span>
          </Popover.Button>
          <Popover.Panel
            data-testid="gizmo-view-menu"
            className={`absolute bottom-full right-0 mb-2 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
      border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
      shadow-lg`}
          >
            <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
              {items.map((item, index) => (
                <li
                  key={index}
                  className="contents"
                  onClick={() => popover.close()}
                >
                  {item}
                </li>
              ))}
            </ul>
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}
