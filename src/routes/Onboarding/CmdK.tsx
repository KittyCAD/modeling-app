import usePlatform from 'hooks/usePlatform'
import { OnboardingButtons, kbdClasses, useDismiss, useNextClick } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useModelingContext } from 'hooks/useModelingContext'
import { hotkeyDisplay } from 'lib/hotkeyWrapper'
import { COMMAND_PALETTE_HOTKEY } from 'components/CommandBar/CommandBar'

export default function CmdK() {
  const { context } = useModelingContext()
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.USER_MENU)
  const platformName = usePlatform()

  return (
    <div className="fixed inset-0 z-50 grid items-end justify-center pointer-events-none">
      <div
        className={
          'max-w-full xl:max-w-4xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (context.store?.buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <h2 className="text-2xl font-bold">Command Bar</h2>
        <p className="my-4">
          Press{' '}
          <kbd className={kbdClasses}>
            {hotkeyDisplay(COMMAND_PALETTE_HOTKEY, platformName)}
          </kbd>{' '}
          to open the command bar. Try changing your theme with it.
        </p>
        <p className="my-4">
          We are working on a command bar that will allow you to quickly see and
          search for any available commands. We are building Zoo Modeling App's
          state management system on top of{' '}
          <a
            href="https://xstate.js.org/"
            rel="noreferrer noopener"
            target="_blank"
          >
            XState
          </a>
          . You can control settings, authentication, and file management from
          the command bar, as well as a growing number of modeling commands.
        </p>
        <OnboardingButtons
          currentSlug={onboardingPaths.COMMAND_K}
          dismiss={dismiss}
          next={next}
          nextText="Next: User Menu"
        />
      </div>
    </div>
  )
}
