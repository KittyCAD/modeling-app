import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { useDismiss } from '.'
import { useEffect } from 'react'
import { useStore } from 'useStore'
import { bracket } from 'lib/exampleKcl'
import { useDotDotSlash } from 'hooks/useDotDotSlash'

export default function FutureWork() {
  const dismiss = useDismiss()
  const { deferredSetCode } = useStore((s) => ({
    deferredSetCode: s.deferredSetCode,
  }))
  const dotDotSlash = useDotDotSlash()

  useEffect(() => {
    deferredSetCode(bracket)
  }, [deferredSetCode])

  return (
    <div className="fixed grid justify-center items-center inset-0 bg-chalkboard-100/50 z-50">
      <div className="max-w-full xl:max-w-2xl flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded">
        <h1 className="text-2xl font-bold">Future Work</h1>
        <p className="my-4">
          We have curves, cuts, and many more CAD features coming soon. We want
          your feedback on this user interface, and we want to know what
          features you want to see next. Please message us in the Discord server
          and open issues on GitHub.
        </p>
        <p className="my-4">
          If you make anything with the app we'd love to see it! Thank you for
          taking time to try out KittyCAD Modeling App, and build the future of
          hardware design with us 💚.
        </p>
        <p className="my-4">— The KittyCAD Team</p>
        <div className="flex justify-between mt-6">
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
            onClick={() => dismiss(dotDotSlash(2))}
            icon={{ icon: faArrowRight }}
          >
            Finish
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
