import { OnboardingButtons, useDismiss, useNextClick } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useStore } from '../../useStore'
import { useEffect, useState } from 'react'

export default function UserMenu() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.PROJECT_MENU)
  const [avatarErrored, setAvatarErrored] = useState(false)
  const buttonDescription = !avatarErrored ? 'your avatar' : 'the menu button'

  // Set up error handling for the user's avatar image,
  // so the onboarding text can be updated if it fails to load.
  useEffect(() => {
    const element = globalThis.document.querySelector(
      '[data-testid="user-sidebar-toggle"] img'
    )

    if (element?.tagName === 'IMG') {
      element.addEventListener('error', () => setAvatarErrored(true))
    }
  }, [])

  return (
    <div className="fixed grid justify-center items-start inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-xl flex flex-col border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1">
          <h2 className="text-2xl font-bold">User Menu</h2>
          <p className="my-4">
            Click {buttonDescription} in the upper right to open the user menu.
            You can change your settings, sign out, or request a feature.
          </p>
          <p className="my-4">
            We only support global settings at the moment, but we are working to
            implement{' '}
            <a
              href="https://github.com/KittyCAD/modeling-app/issues/1503"
              target="_blank"
              rel="noreferrer noopener"
            >
              per-project settings
            </a>{' '}
            now.
          </p>
        </section>
        <OnboardingButtons
          currentSlug={onboardingPaths.USER_MENU}
          dismiss={dismiss}
          next={next}
          nextText="Next: Project Menu"
        />
      </div>
    </div>
  )
}
