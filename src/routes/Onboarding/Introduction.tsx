import { APP_NAME } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { Themes, getSystemTheme } from '@src/lib/theme'
import { useSettings } from '@src/lib/singletons'
import {
  onboardingPaths,
  OnboardingButtons,
  useDemoCode,
} from '@src/routes/Onboarding/utils'

export default function Introduction() {
  // Reset the code to the bracket code
  useDemoCode()

  const {
    app: { theme },
  } = useSettings()
  const getLogoTheme = () =>
    theme.current === Themes.Light ||
    (theme.current === Themes.System && getSystemTheme() === Themes.Light)
      ? '-dark'
      : ''

  return (
    <div className="fixed inset-0 z-50 grid place-content-center bg-chalkboard-110/50">
      <div className="relative max-w-3xl p-8 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
        <h1 className="flex flex-wrap items-center gap-4 text-3xl font-bold">
          <img
            src={`${isDesktop() ? '.' : ''}/zma-logomark${getLogoTheme()}.svg`}
            alt={APP_NAME}
            className="h-20 max-w-full"
          />
          <span className="px-3 py-1 text-base rounded-full bg-primary/10 text-primary">
            Alpha
          </span>
        </h1>
        <section className="my-12">
          <p className="my-4">
            Welcome to {APP_NAME}! This is a hardware design tool that lets you
            edit visually, with code, or both. It's powered by the KittyCAD
            Design API, the first API created for anyone to build hardware
            design tools. The 3D view is not running on your computer, but is
            instead being streamed to you from an instance of our Geometry
            Engine on a remote GPU as video.
          </p>
          <p className="my-4">
            This is an alpha release, so you will encounter bugs and missing
            features. You can read our{' '}
            <a
              href="https://gist.github.com/jgomez720/5cd53fb7e8e54079f6dc0d2625de5393"
              target="_blank"
              rel="noreferrer noopener"
            >
              expectations for alpha users here
            </a>
            , and please give us feedback on your experience{' '}
            <a
              href="https://discord.com/invite/JQEpHR7Nt2"
              target="_blank"
              rel="noreferrer noopener"
            >
              our Discord
            </a>
            ! We are trying to release as early as possible to get feedback from
            users like you.
          </p>
          <p>
            As you go through the onboarding, we'll be changing and resetting
            your code occasionally, so that we can reference specific code
            features. So hold off on writing production KCL code until you're
            done with the onboarding 😉
          </p>
        </section>
        <OnboardingButtons
          currentSlug={onboardingPaths.WELCOME}
          className="mt-6"
        />
      </div>
    </div>
  )
}
