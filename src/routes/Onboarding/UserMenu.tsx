import { OnboardingButtons } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useEffect, useState } from 'react'
import { useUser } from 'machines/appMachine'

export default function UserMenu() {
  const user = useUser()
  const [avatarErrored, setAvatarErrored] = useState(false)

  const errorOrNoImage = !user?.image || avatarErrored
  const buttonDescription = errorOrNoImage ? 'the menu button' : 'your avatar'

  // Set up error handling for the user's avatar image,
  // so the onboarding text can be updated if it fails to load.
  useEffect(() => {
    const element = globalThis.document.querySelector(
      '[data-testid="user-sidebar-toggle"] img'
    )

    const onError = () => setAvatarErrored(true)
    if (element?.tagName === 'IMG') {
      element?.addEventListener('error', onError)
    }
    return () => {
      element?.removeEventListener('error', onError)
    }
  }, [])

  return (
    <div className="fixed grid justify-center items-start inset-0 z-50 pointer-events-none">
      <div
        className={
          'relative pointer-events-auto max-w-xl flex flex-col border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded'
        }
      >
        <section className="flex-1">
          <h2 className="text-2xl font-bold">User Menu</h2>
          <p className="my-4">
            Click {buttonDescription} in the upper right to open the user menu.
            You can change your user-level settings, sign out, report a bug,
            manage your account, request a feature, and more.
          </p>
          <p className="my-4">
            Many settings can be set either a user or per-project level. User
            settings will apply to all projects, while project settings will
            only apply to the current project.
          </p>
        </section>
        <OnboardingButtons currentSlug={onboardingPaths.USER_MENU} />
      </div>
    </div>
  )
}
