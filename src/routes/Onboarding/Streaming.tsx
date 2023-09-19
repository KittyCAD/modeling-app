import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { onboardingPaths, useDismiss, useNextClick } from '.'
import { useStore } from '../../useStore'
import { useLocation } from 'react-router-dom'
import { dotDotSlash } from 'lib/utils'

export default function Streaming() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.EDITOR)
  const location = useLocation()

  return (
    <div className="fixed grid justify-start items-center inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-xl h-3/4 flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1">
          <h2 className="text-2xl">Streaming Video</h2>
          <p className="my-4">
            The 3D view is not running on your computer. Instead, our
            infrastructure spins up the KittyCAD Geometry Engine on a remote
            GPU, KittyCAD Modeling App sends it a series of commands via
            Websockets and WebRTC, and the Geometry Engine sends back a video
            stream of the 3D view.
          </p>
          <p className="my-4">
            This means that you could run KittyCAD Modeling App on a Chromebook,
            a tablet, or even a phone, as long as you have a good internet
            connection.
          </p>
          <p className="my-4">
            It also means that whatever tools you build on top of the KittyCAD
            Geometry Engine will be able to run on any device with a browser,
            and you won't have to worry about the performance of the device.
          </p>
        </section>
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
            Next: Code Editing
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
