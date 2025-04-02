import { Switch } from '@headlessui/react'
import { useEffect, useState } from 'react'

import { settingsActor, useSettings } from '@src/machines/appMachine'

export function CameraProjectionToggle() {
  const settings = useSettings()
  const isCameraProjectionPerspective =
    settings.modeling.cameraProjection.current === 'perspective'
  const [checked, setChecked] = useState(isCameraProjectionPerspective)

  useEffect(() => {
    setChecked(settings.modeling.cameraProjection.current === 'perspective')
  }, [settings.modeling.cameraProjection.current])

  return (
    <Switch
      checked={checked}
      onChange={(newValue) => {
        settingsActor.send({
          type: 'set.modeling.cameraProjection',
          data: {
            level: 'user',
            value: newValue ? 'perspective' : 'orthographic',
          },
        })
      }}
      className={`pointer-events-auto p-0 text-xs text-chalkboard-60 dark:text-chalkboard-40 bg-chalkboard-10/70 hover:bg-chalkboard-10 dark:bg-chalkboard-100/80 dark:hover:bg-chalkboard-100 backdrop-blur-sm 
        border border-primary/10 hover:border-primary/50 focus-visible:border-primary/50 rounded-full`}
    >
      <span className="sr-only">Camera projection: </span>
      <div className="flex items-center gap-2">
        <span
          aria-hidden={checked}
          className={
            'border border-solid m-[-1px] rounded-full px-2 py-1 ' +
            (!checked
              ? 'text-primary border-primary -mr-2'
              : 'border-transparent')
          }
        >
          Orthographic
        </span>
        <span
          aria-hidden={checked}
          className={
            'border border-solid m-[-1px] rounded-full px-2 py-1 ' +
            (checked
              ? 'text-primary border-primary -ml-2'
              : 'border-transparent')
          }
        >
          Perspective
        </span>
      </div>
    </Switch>
  )
}
