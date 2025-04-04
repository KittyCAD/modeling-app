import { COMMAND_PALETTE_HOTKEY } from '@src/components/CommandBar/CommandBar'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import { onboardingPaths } from '@src/routes/Onboarding/paths'

import { OnboardingButtons, kbdClasses } from '@src/routes/Onboarding/utils'

export default function CmdK() {
  const platformName = usePlatform()

  return (
    <div className="fixed inset-0 z-50 grid items-end justify-center pointer-events-none">
      <div
        className={
          'relative pointer-events-auto max-w-full xl:max-w-4xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded'
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
          search for any available commands. We are building Zoo Design Studio's
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
        <OnboardingButtons currentSlug={onboardingPaths.COMMAND_K} />
      </div>
    </div>
  )
}
