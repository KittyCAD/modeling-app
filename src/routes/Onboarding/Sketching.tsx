import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { onboardingPaths, useDismiss, useNextClick } from '.'
import { useStore } from 'useStore'
import { useEffect } from 'react'

export default function Sketching() {
  const { deferredSetCode, buttonDownInStream } = useStore((s) => ({
    deferredSetCode: s.deferredSetCode,
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.FUTURE_WORK)

  useEffect(() => {
    deferredSetCode('')
  }, [deferredSetCode])

  return (
    <div className="fixed grid justify-center items-end inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-full xl:max-w-2xl flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <h1 className="text-2xl font-bold">Sketching</h1>
        <p className="my-4">
          Our 3D modeling tools are still very much a work in progress, but we
          want to show you some early features. Try creating a sketch by
          clicking Create Sketch in the top toolbar, then clicking the Line
          tool, and clicking in the 3D view.
        </p>
        <p className="my-4">
          Watch the code pane as you click. Point-and-click interactions are
          always just modifying and generating code in KittyCAD Modeling App.
        </p>
        <div className="flex justify-between mt-6">
          <ActionButton
            Element="button"
            onClick={dismiss}
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
            Next: Future Work
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
