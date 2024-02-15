import { OnboardingButtons, useDismiss, useNextClick } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useStore } from '../../useStore'
import { isTauri } from 'lib/isTauri'

export default function ProjectMenu() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.EXPORT)

  return (
    <div className="fixed grid justify-center items-start inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-xl flex flex-col border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1">
          <h2 className="text-2xl font-bold">Project Menu</h2>
          <p className="my-4">
            Click on the Zoo logo in the upper left to open the project menu.
            You can only {isTauri() && 'go home or '}export your model—which
            we'll talk about next—for now. We'll add more options here soon,
            especially as we add support for multi-file assemblies.
          </p>
        </section>
        <OnboardingButtons
          next={next}
          dismiss={dismiss}
          nextText="Next: Export"
        />
      </div>
    </div>
  )
}
