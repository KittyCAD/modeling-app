import { onboardingPaths } from 'routes/Onboarding/paths'

import { OnboardingButtons } from '.'

export default function Streaming() {
  return (
    <div className="fixed grid justify-start items-center inset-0 z-50 pointer-events-none">
      <div
        className={
          'relative pointer-events-auto max-w-xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg h-[75vh] flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded'
        }
      >
        <section className="flex-1 overflow-y-auto">
          <h2 className="text-3xl font-bold">Streaming Video</h2>
          <p className="my-4">
            Historically, CAD programs run on your computer, so to run
            performance-heavy apps you have to have a powerful, expensive
            desktop. But the 3D scene you see here is not running on your
            computer.
          </p>
          <p className="my-4">
            Instead, our infrastructure spins up our Geometry Engine on a remote
            GPU, Modeling App sends it a series of commands{' '}
            <a
              href="https://zoo.dev/blog/cad-webrtc"
              rel="noopener noreferrer"
              target="_blank"
            >
              via Websockets and WebRTC
            </a>
            , and the Geometry Engine sends back a video stream of the 3D view.
          </p>
          <p className="my-4">
            This means that you could run our Modeling App on nearly any device
            with a good internet connection.
          </p>
          <p className="my-4">
            It also means that whatever tools you build on top of our Geometry
            Engine will be able to run on any device with a browser, and you
            won't have to worry about the performance of the device.
          </p>
        </section>
        <OnboardingButtons
          currentSlug={onboardingPaths.STREAMING}
          dismissClassName="right-auto left-full"
        />
      </div>
    </div>
  )
}
