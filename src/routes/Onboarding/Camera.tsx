import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { onboardingPaths, useDismiss, useNextClick } from '.'
import { useStore } from '../../useStore'
import { SettingsSection } from 'routes/Settings'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import {
  CameraSystem,
  cameraMouseDragGuards,
  cameraSystems,
} from 'lib/cameraControls'
import { useLocation } from 'react-router-dom'
import { dotDotSlash } from 'lib/utils'

export default function Units() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.STREAMING)
  const {
    settings: {
      send,
      state: {
        context: { cameraControls },
      },
    },
  } = useGlobalStateContext()
  const location = useLocation()

  return (
    <div className="fixed grid justify-center items-end inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-2xl flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <SettingsSection
          title="Camera Controls"
          description="How you want to control the camera in the 3D view. Try them out above and choose the one that feels most comfortable to you."
        >
          <select
            id="camera-controls"
            className="block w-full px-3 py-1 border border-chalkboard-30 bg-transparent"
            value={cameraControls}
            onChange={(e) => {
              send({
                type: 'Set Camera Controls',
                data: { cameraControls: e.target.value as CameraSystem },
              })
            }}
          >
            {cameraSystems.map((program) => (
              <option key={program} value={program}>
                {program}
              </option>
            ))}
          </select>
          <ul className="text-sm my-2 mx-4 leading-relaxed">
            <li>
              <strong>Pan:</strong>{' '}
              {cameraMouseDragGuards[cameraControls].pan.description}
            </li>
            <li>
              <strong>Zoom:</strong>{' '}
              {cameraMouseDragGuards[cameraControls].zoom.description}
            </li>
            <li>
              <strong>Rotate:</strong>{' '}
              {cameraMouseDragGuards[cameraControls].rotate.description}
            </li>
          </ul>
        </SettingsSection>
        <div className="flex justify-between">
          <ActionButton
            Element="button"
            onClick={() => dismiss(dotDotSlash(2))}
            icon={{
              icon: faXmark,
              bgClassName: 'bg-destroy-80',
              iconClassName:
                'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
            }}
            className="hover:border-destroy-40"
          >
            Dismiss
          </ActionButton>
          <ActionButton
            Element="button"
            onClick={next}
            icon={{ icon: faArrowRight }}
          >
            Next: Streaming
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
