import { Popover } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useMenuListener } from '@src/hooks/useMenu'
import { isDesktop } from '@src/lib/isDesktop'
import { onboardingStartPath } from '@src/lib/onboardingPaths'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS } from '@src/lib/paths'
import { codeManager, kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { WebContentSendPayload } from '@src/menu/channels'
import {
  acceptOnboarding,
  catchOnboardingWarnError,
} from '@src/routes/Onboarding/utils'
import { useLocation, useNavigate } from 'react-router-dom'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'

const HelpMenuDivider = () => (
  <div className="h-[1px] bg-chalkboard-110 dark:bg-chalkboard-80" />
)

export function HelpMenu() {
  const navigate = useNavigate()
  const location = useLocation()
  const filePath = useAbsoluteFilePath()

  const resetOnboardingWorkflow = () => {
    const props = {
      onboardingStatus: onboardingStartPath,
      navigate,
      codeManager,
      kclManager,
    }
    acceptOnboarding(props).catch((reason) =>
      catchOnboardingWarnError(reason, props)
    )
  }

  const cb = (data: WebContentSendPayload) => {
    if (data.menuLabel === 'Help.Replay onboarding tutorial') {
      resetOnboardingWorkflow()
    }
  }
  useMenuListener(cb)

  return (
    <Popover className="relative flex items-stretch">
      <Popover.Button
        className={`${defaultStatusBarItemClassNames} m-0`}
        data-testid="help-button"
      >
        <CustomIcon name="questionMark" className="w-5 h-5" />
        <span className="sr-only">Help and resources</span>
        <Tooltip position="top-right" wrapperClassName="ui-open:hidden">
          Help and resources
        </Tooltip>
      </Popover.Button>
      <Popover.Panel
        as="ul"
        className="absolute right-0 left-auto flex flex-col w-64 gap-1 p-0 py-2 m-0 mb-1 text-sm border border-solid rounded shadow-lg bottom-full align-stretch text-chalkboard-10 dark:text-inherit bg-chalkboard-110 dark:bg-chalkboard-100 border-chalkboard-110 dark:border-chalkboard-80"
      >
        {({ close }) => (
          <>
            <HelpMenuItem
              as="a"
              href="https://github.com/KittyCAD/modeling-app/issues/new/choose"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report a bug
            </HelpMenuItem>
            <HelpMenuItem
              as="a"
              href="https://github.com/KittyCAD/modeling-app/discussions"
              target="_blank"
              rel="noopener noreferrer"
            >
              Request a feature
            </HelpMenuItem>
            <HelpMenuItem
              as="a"
              href="https://discord.gg/JQEpHR7Nt2"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ask the community
            </HelpMenuItem>
            <HelpMenuDivider />
            <HelpMenuItem
              as="a"
              href={withSiteBaseURL('/docs/kcl-samples')}
              target="_blank"
              rel="noopener noreferrer"
            >
              KCL code samples
            </HelpMenuItem>
            <HelpMenuItem
              as="a"
              href={withSiteBaseURL('/docs/kcl-lang')}
              target="_blank"
              rel="noopener noreferrer"
            >
              KCL docs
            </HelpMenuItem>
            <HelpMenuDivider />
            <HelpMenuItem
              as="a"
              href="https://github.com/KittyCAD/modeling-app/releases"
              target="_blank"
              rel="noopener noreferrer"
            >
              Release notes
            </HelpMenuItem>
            {isDesktop() && (
              <HelpMenuItem
                as="button"
                onClick={() => {
                  close()
                  window.electron?.appCheckForUpdates().catch(reportRejection)
                }}
              >
                Check for updates
              </HelpMenuItem>
            )}
            <HelpMenuItem
              as="button"
              onClick={() => {
                const targetPath = location.pathname.includes(PATHS.FILE)
                  ? filePath + PATHS.SETTINGS_KEYBINDINGS
                  : PATHS.HOME + PATHS.SETTINGS_KEYBINDINGS
                navigate(targetPath)
              }}
              data-testid="keybindings-button"
            >
              Keyboard shortcuts
            </HelpMenuItem>
            <HelpMenuItem
              as="button"
              onClick={() => {
                close()
                resetOnboardingWorkflow()
              }}
            >
              Replay onboarding tutorial
            </HelpMenuItem>
          </>
        )}
      </Popover.Panel>
    </Popover>
  )
}

type HelpMenuItemProps =
  | ({
      as: 'a'
    } & React.ComponentProps<'a'>)
  | ({
      as: 'button'
    } & React.ComponentProps<'button'>)

function HelpMenuItem({
  as,
  children,
  className,
  ...props
}: HelpMenuItemProps) {
  const baseClassName = 'block px-2 py-1 hover:bg-chalkboard-80'
  return (
    <li className="p-0 m-0">
      {as === 'a' ? (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <a
          {...(props as React.ComponentProps<'a'>)}
          onClick={openExternalBrowserIfDesktop(
            (props as React.ComponentProps<'a'>).href
          )}
          className={`no-underline text-inherit ${baseClassName} ${className}`}
        >
          {children}
        </a>
      ) : (
        <button
          {...(props as React.ComponentProps<'button'>)}
          className={`border-0 p-0 m-0 text-sm w-full rounded-none text-left ${baseClassName} ${className}`}
        >
          {children}
        </button>
      )}
    </li>
  )
}
