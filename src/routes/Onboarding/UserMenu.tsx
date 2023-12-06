import { OnboardingButtons, onboardingPaths, useDismiss, useNextClick } from '.'
import { useStore } from '../../useStore'

export default function UserMenu() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.PROJECT_MENU)

  return (
    <div className="fixed grid justify-center items-start inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-xl flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1">
          <h2 className="text-2xl">User Menu</h2>
          <p className="my-4">
            Click your avatar on the upper right to open the user menu. You can
            change your settings, sign out, or request a feature.
          </p>
        </section>
        <OnboardingButtons
          dismiss={dismiss}
          next={next}
          nextText="Next: Project Menu"
        />
      </div>
    </div>
  )
}
