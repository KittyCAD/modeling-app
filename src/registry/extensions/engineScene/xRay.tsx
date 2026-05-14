import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useSingletons } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import { throttle } from '@src/lib/utils'
import { useMemo } from 'react'
import {
  applyXRayTransparencyToScene,
  xRayTransparency,
} from './xRayPostprocessor'

const X_RAY_COMMAND_THROTTLE_MS = 80
const X_RAY_TRANSPARENCY_INPUT_ID = 'engine-scene-x-ray-transparency-input'

export function EngineSceneXRayControl() {
  useSignals()
  const { kclManager } = useSingletons()
  const transparency = xRayTransparency.value
  const isActive = transparency < 1

  const applyTransparency = useMemo(
    () =>
      throttle((nextTransparency: number) => {
        applyXRayTransparencyToScene({
          artifactGraph: kclManager.artifactGraph,
          engineCommandManager: kclManager.engineCommandManager,
          transparency: nextTransparency,
          force: true,
        }).catch(reportRejection)
      }, X_RAY_COMMAND_THROTTLE_MS),
    [kclManager]
  )

  return (
    <Popover
      className="relative pointer-events-auto"
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {() => (
        <>
          <Popover.Button
            aria-label="X-Ray"
            data-testid="engine-scene-x-ray-button"
            className={`relative m-0 flex h-8 w-8 items-center justify-center rounded-sm border border-solid p-0 shadow-lg backdrop-blur-sm ${
              isActive
                ? 'border-primary bg-primary/20 text-primary'
                : 'border-chalkboard-30 bg-chalkboard-10/90 text-chalkboard-100 hover:border-chalkboard-50 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100/80 dark:text-chalkboard-10 dark:hover:border-chalkboard-60'
            }`}
          >
            <CustomIcon name="eyeOpen" className="h-5 w-5" />
            <Tooltip hoverOnly={true} position="top-right">
              X-Ray
            </Tooltip>
          </Popover.Button>
          <Popover.Panel className="absolute bottom-full right-0 mb-2 flex w-52 flex-col gap-2 rounded-sm border border-solid border-chalkboard-30 bg-chalkboard-10/95 p-3 text-xs text-chalkboard-100 shadow-lg backdrop-blur-sm dark:border-chalkboard-70 dark:bg-chalkboard-100/95 dark:text-chalkboard-10">
            <label
              className="flex items-center justify-between gap-3"
              htmlFor={X_RAY_TRANSPARENCY_INPUT_ID}
            >
              <span>Transparency</span>
              <span className="tabular-nums">
                {Math.round(transparency * 100)}%
              </span>
            </label>
            <input
              id={X_RAY_TRANSPARENCY_INPUT_ID}
              aria-label="X-Ray transparency"
              data-testid="engine-scene-x-ray-transparency"
              className="w-full cursor-pointer"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={transparency}
              onChange={(event) => {
                const nextTransparency = Number(event.currentTarget.value)
                xRayTransparency.value = nextTransparency
                applyTransparency(nextTransparency)
              }}
            />
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}
