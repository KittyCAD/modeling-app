import { OnboardingButtons, useDismiss } from '.'
import { useEffect } from 'react'
import { bracket } from 'lib/exampleKcl'
import { kclManager } from 'lang/KclSingleton'
import { useModelingContext } from 'hooks/useModelingContext'
import { APP_NAME } from 'lib/constants'

export default function FutureWork() {
  const { send } = useModelingContext()
  const dismiss = useDismiss()

  useEffect(() => {
    if (kclManager.engineCommandManager.engineConnection?.isReady()) {
      // If the engine is ready, promptly execute the loaded code
      kclManager.setCodeAndExecute(bracket)
    } else {
      // Otherwise, just set the code and wait for the connection to complete
      kclManager.setCode(bracket)
    }

    send({ type: 'Cancel' }) // in case the user hit 'Next' while still in sketch mode
  }, [send])

  return (
    <div className="fixed grid justify-center items-center inset-0 bg-chalkboard-100/50 z-50">
      <div className="max-w-full xl:max-w-2xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded">
        <h1 className="text-2xl font-bold">Future Work</h1>
        <p className="my-4">
          We have curves, cuts, and many more CAD features coming soon. We want
          your feedback on this user interface, and we want to know what
          features you want to see next. Please message us in the Discord server
          and open issues on GitHub.
        </p>
        <p className="my-4">
          If you make anything with the app we'd love to see it! Thank you for
          taking time to try out {APP_NAME}, and build the future of hardware
          design with us.
        </p>
        <p className="my-4">💚 The Zoo Team</p>
        <OnboardingButtons
          className="mt-6"
          dismiss={dismiss}
          next={dismiss}
          nextText="Finish"
        />
      </div>
    </div>
  )
}
