import { OnboardingButtons, useDismiss, useNextClick } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useStore } from '../../useStore'
import { SettingsSection } from 'routes/Settings'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import {
  CameraSystem,
  cameraMouseDragGuards,
  cameraSystems,
} from 'lib/cameraControls'

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

  return (
    <div className="fixed inset-0 z-50 grid items-end justify-start px-4 pointer-events-none">
      <div
        className={
          'max-w-2xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <SettingsSection
          title="Camera Controls"
          description="How you want to control the camera in the 3D view. Try them out above and choose the one that feels most comfortable to you."
          className="my-4 last-of-type:mb-12"
        >
          <select
            id="camera-controls"
            className="block w-full px-3 py-1 bg-transparent border border-chalkboard-30"
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
          <ul className="mx-4 my-2 text-sm leading-relaxed">
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
        <OnboardingButtons
          dismiss={dismiss}
          next={next}
          nextText="Next: Streaming"
        />
      </div>
    </div>
  )
}
