import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { onboardingPaths, useDismiss, useNextClick } from '.'
import { useStore } from '../../useStore'

export default function Units() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.SKETCHING)

  return (
    <div className="fixed grid justify-center items-end inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-2xl flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <h1 className="text-2xl font-bold">Camera</h1>
        <p className="mt-6">
          Moving the camera is easy! The controls are as you might expect:
        </p>
        <ul className="list-disc list-outside ms-8 mb-4">
          <li>Click and drag anywhere in the scene to rotate the camera</li>
          <li>
            Hold down the <kbd>Shift</kbd> key while clicking and dragging to
            pan the camera
          </li>
          <li>
            Hold down the <kbd>Ctrl</kbd> key while dragging to zoom. You can
            also use the scroll wheel to zoom in and out.
          </li>
        </ul>
        <p>
          What you're seeing here is just a video, and your interactions are
          being sent to our Geometry Engine API, which sends back video frames
          in real time. How cool is that? It means that you can use KittyCAD
          Modeling App (or whatever you want to build) on any device, even a
          cheap laptop with no graphics card!
        </p>
        <div className="flex justify-between mt-6">
          <ActionButton
            Element="button"
            onClick={() => dismiss('../../')}
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
            Next: Sketching
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
