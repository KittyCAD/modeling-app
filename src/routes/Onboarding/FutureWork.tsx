import { OnboardingButtons, useDemoCode } from '.'
import { useEffect } from 'react'
import { useModelingContext } from 'hooks/useModelingContext'
import { APP_NAME } from 'lib/constants'
import { onboardingPaths } from './paths'
import { sceneInfra } from 'lib/singletons'

export default function FutureWork() {
  const { send } = useModelingContext()

  // Reset the code, the camera, and the modeling state
  useDemoCode()
  useEffect(() => {
    send({ type: 'Cancel' }) // in case the user hit 'Next' while still in sketch mode
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    sceneInfra.camControls.resetCameraPosition()
  }, [send])

  return (
    <div className="fixed grid justify-center items-center inset-0 bg-chalkboard-100/50 z-50">
      <div className="relative max-w-full xl:max-w-2xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded">
        <h1 className="text-2xl font-bold">Future Work</h1>
        <p className="my-4">
          We have curves, cuts, multi-profile sketch mode, and many more CAD
          features coming soon. We want your feedback on this user interface,
          and we want to know what features you want to see next. Please message
          us in{' '}
          <a
            href="https://discord.gg/JQEpHR7Nt2"
            target="_blank"
            rel="noreferrer noopener"
          >
            our Discord server
          </a>
          and{' '}
          <a
            href="https://github.com/KittyCAD/modeling-app/issues/new/choose"
            rel="noreferrer noopener"
            target="_blank"
          >
            open issues on GitHub
          </a>
          .
        </p>
        <p className="my-4">
          If you make anything with the app we'd love to see it, feel free to{' '}
          <a
            href="https://twitter.com/zoodotdev"
            target="_blank"
            rel="noreferrer noopener"
          >
            tag us on X
          </a>
          ! Thank you for taking time to try out {APP_NAME}, and build the
          future of hardware design with us.
        </p>
        <p className="my-4">💚 The Zoo Team</p>
        <OnboardingButtons
          currentSlug={onboardingPaths.FUTURE_WORK}
          className="mt-6"
        />
      </div>
    </div>
  )
}
