import { OnboardingButtons, useDismiss, useNextClick } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import {
  CameraSystem,
  cameraMouseDragGuards,
  cameraSystems,
} from 'lib/cameraControls'
import { SettingsSection } from 'components/Settings/SettingsSection'
import { settingsActor, useSettings } from 'machines/appMachine'

export default function Units() {
  useDismiss()
  useNextClick(onboardingPaths.STREAMING)
  const {
    modeling: { mouseControls },
  } = useSettings()

  return (
    <div className="fixed inset-0 z-50 grid items-end justify-start px-4 pointer-events-none">
      <div
        className={
          'relative pointer-events-auto max-w-2xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded'
        }
      >
        <SettingsSection
          title="Mouse Controls"
          description="Choose what buttons you want to use on your mouse or trackpad to move around the 3D view. Try them out above and choose the one that feels most comfortable to you."
          className="my-4 last-of-type:mb-12"
          headingClassName="text-3xl font-bold"
        >
          <select
            id="camera-controls"
            className="block w-full px-3 py-1 bg-transparent border border-chalkboard-30"
            value={mouseControls.current}
            onChange={(e) => {
              settingsActor.send({
                type: 'set.modeling.mouseControls',
                data: {
                  level: 'user',
                  value: e.target.value as CameraSystem,
                },
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
              {cameraMouseDragGuards[mouseControls.current].pan.description}
            </li>
            <li>
              <strong>Zoom:</strong>{' '}
              {cameraMouseDragGuards[mouseControls.current].zoom.description}
            </li>
            <li>
              <strong>Rotate:</strong>{' '}
              {cameraMouseDragGuards[mouseControls.current].rotate.description}
            </li>
          </ul>
        </SettingsSection>
        <OnboardingButtons
          currentSlug={onboardingPaths.CAMERA}
          dismissClassName="right-auto left-full"
        />
      </div>
    </div>
  )
}
