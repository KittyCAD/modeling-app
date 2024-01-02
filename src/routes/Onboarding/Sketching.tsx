import { OnboardingButtons, onboardingPaths, useDismiss, useNextClick } from '.'
import { useStore } from 'useStore'
import { useEffect } from 'react'
import { kclManager } from 'lang/KclSinglton'

export default function Sketching() {
  const buttonDownInStream = useStore((s) => s.buttonDownInStream)
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.FUTURE_WORK)

  useEffect(() => {
    if (kclManager.engineCommandManager.engineConnection?.isReady()) {
      // If the engine is ready, promptly execute the loaded code
      kclManager.setCodeAndExecute('')
    } else {
      // Otherwise, just set the code and wait for the connection to complete
      kclManager.setCode('')
    }
  }, [])

  return (
    <div className="fixed grid justify-center items-end inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-full xl:max-w-2xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
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
          always just modifying and generating code in Zoo Modeling App.
        </p>
        <OnboardingButtons
          className="mt-6"
          next={next}
          dismiss={dismiss}
          nextText="Next: Future Work"
        />
      </div>
    </div>
  )
}
