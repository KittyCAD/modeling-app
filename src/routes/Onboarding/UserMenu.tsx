import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { onboardingPaths, useDismiss, useNextClick } from '.'
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
        <div className="flex justify-between">
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
            Next: Project Menu
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
