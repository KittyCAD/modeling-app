import { Popover } from '@headlessui/react'
import { useSelector } from '@xstate/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { isDesktop } from '@src/lib/isDesktop'
import { _3dMouseActor, sceneInfra } from '@src/lib/singletons'
import { ActionButton } from '@src/components/ActionButton'
import {
  _3DMouseMachineEvents,
  _3DMouseMachineStates,
} from '@src/machines/_3dMouse/utils'

export const ExternalMouseIndicator = ({
  className,
}: {
  className?: string
}) => {
  const useMouseState = useSelector(_3dMouseActor, (state) => {
    return state.value
  })

  return isDesktop() ? (
    <Popover className="relative">
      <Popover.Button
        className={
          'flex items-center p-0 border-none bg-transparent dark:bg-transparent relative ' +
          (className || '')
        }
        data-testid="network-machine-toggle"
      >
        <CustomIcon name="keyboard" className="w-5 h-5" />
      </Popover.Button>
      <Popover.Panel
        className="absolute right-0 left-auto bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm"
        data-testid="network-popover"
      >
        <div className="flex items-center justify-between p-2 rounded-t-sm bg-chalkboard-20 dark:bg-chalkboard-80">
          <h2 className="text-sm font-sans font-normal">
            External mouse state
          </h2>
          <p
            data-testid="network"
            className="font-bold text-xs uppercase px-2 py-1 rounded-sm"
          >
            {useMouseState}
          </p>
        </div>
        <ActionButton
          Element="button"
          disabled={useMouseState !== _3DMouseMachineStates.waitingToConnect}
          onClick={() =>
            _3dMouseActor.send({
              type: _3DMouseMachineEvents.connect,
              data: {
                name: 'zoo-design-studio',
                debug: true,
                canvasId: 'client-side-scene-canvas',
                camera: sceneInfra.camControls.camera,
              },
            })
          }
          className={
            'flex items-center p-2 gap-2 leading-tight border-transparent dark:border-transparent enabled:dark:border-transparent enabled:hover:border-primary/50 enabled:dark:hover:border-inherit active:border-primary dark:bg-transparent hover:bg-transparent'
          }
          data-testid="home-new-file"
        >
          Connect mouse
        </ActionButton>
      </Popover.Panel>
    </Popover>
  ) : null
}
