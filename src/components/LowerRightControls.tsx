import { Link, type NavigateFunction, useLocation } from 'react-router-dom'
import { Popover } from '@headlessui/react'
import {
  BillingRemaining,
  BillingRemainingMode,
} from '@src/components/BillingRemaining'
import { BillingDialog } from '@src/components/BillingDialog'

import { CustomIcon } from '@src/components/CustomIcon'
import { HelpMenu } from '@src/components/HelpMenu'
import { NetworkHealthIndicator } from '@src/components/NetworkHealthIndicator'
import { NetworkMachineIndicator } from '@src/components/NetworkMachineIndicator'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { PATHS } from '@src/lib/paths'
import { APP_VERSION, getReleaseUrl } from '@src/routes/utils'

import { billingActor } from '@src/lib/singletons'
import { ActionButton } from '@src/components/ActionButton'

export function LowerRightControls({
  children,
  navigate = () => {},
}: {
  children?: React.ReactNode
  navigate?: NavigateFunction
}) {
  const location = useLocation()
  const filePath = useAbsoluteFilePath()

  const linkOverrideClassName =
    '!text-chalkboard-70 hover:!text-chalkboard-80 dark:!text-chalkboard-40 dark:hover:!text-chalkboard-30'

  return (
    <section className="fixed bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
      {children}
      <menu className="flex items-center justify-end gap-3 pointer-events-auto">
        <Popover className="relative">
          <Popover.Button
            className="p-0 !border-transparent"
            data-testid="billing-remaining-bar"
          >
            <BillingRemaining
              mode={BillingRemainingMode.ProgressBarFixed}
              billingActor={billingActor}
            />
            <Tooltip position="top" contentClassName="text-xs">
              Text-to-CAD credits
            </Tooltip>
          </Popover.Button>
          <Popover.Panel className="absolute right-0 left-auto bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch rounded-lg shadow-lg text-sm">
            <BillingDialog billingActor={billingActor} />
          </Popover.Panel>
        </Popover>
        <ActionButton
          Element="externalLink"
          to={getReleaseUrl()}
          className={
            '!no-underline !border-none !bg-transparent font-mono text-xs' +
            linkOverrideClassName
          }
        >
          v{APP_VERSION}
        </ActionButton>
        <Link
          to={
            location.pathname.includes(PATHS.FILE)
              ? filePath + PATHS.TELEMETRY + '?tab=project'
              : PATHS.HOME + PATHS.TELEMETRY
          }
          data-testid="telemetry-link"
        >
          <CustomIcon
            name="stopwatch"
            className={`w-5 h-5 ${linkOverrideClassName}`}
          />
          <span className="sr-only">Telemetry</span>
          <Tooltip position="top" contentClassName="text-xs">
            Telemetry
          </Tooltip>
        </Link>
        <Link
          to={
            location.pathname.includes(PATHS.FILE)
              ? filePath + PATHS.SETTINGS + '?tab=project'
              : PATHS.HOME + PATHS.SETTINGS
          }
          data-testid="settings-link"
        >
          <CustomIcon
            name="settings"
            className={`w-5 h-5 ${linkOverrideClassName}`}
          />
          <span className="sr-only">Settings</span>
          <Tooltip position="top" contentClassName="text-xs">
            Settings
          </Tooltip>
        </Link>
        <NetworkMachineIndicator className={linkOverrideClassName} />
        {!location.pathname.startsWith(PATHS.HOME) && (
          <NetworkHealthIndicator />
        )}
        <HelpMenu navigate={navigate} />
      </menu>
    </section>
  )
}
