import { OnboardingButtons, onboardingPaths, useDismiss, useNextClick } from '.'
import { useStore } from '../../useStore'

export default function Streaming() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.EDITOR)

  return (
    <div className="fixed grid justify-start items-center inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg h-3/4 flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1">
          <h2 className="text-2xl">Streaming Video</h2>
          <p className="my-4">
            The 3D view is not running on your computer. Instead, our
            infrastructure spins up the Zoo Geometry Engine on a remote GPU, Zoo
            Modeling App sends it a series of commands via Websockets and
            WebRTC, and the Geometry Engine sends back a video stream of the 3D
            view.
          </p>
          <p className="my-4">
            This means that you could run Zoo Modeling App on a Chromebook, a
            tablet, or even a phone, as long as you have a good internet
            connection.
          </p>
          <p className="my-4">
            It also means that whatever tools you build on top of the Zoo
            Geometry Engine will be able to run on any device with a browser,
            and you won't have to worry about the performance of the device.
          </p>
        </section>
        <OnboardingButtons
          dismiss={dismiss}
          next={next}
          nextText="Next: Code Editor"
        />
      </div>
    </div>
  )
}
