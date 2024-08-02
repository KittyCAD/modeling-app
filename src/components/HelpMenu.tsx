import { Popover } from '@headlessui/react'
import Tooltip from './Tooltip'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { CustomIcon } from './CustomIcon'
import { useLocation, useNavigate } from 'react-router-dom'
import { createAndOpenNewProject } from 'lib/tauriFS'
import { paths } from 'lib/paths'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'

const HelpMenuDivider = () => (
  <div className="h-[1px] bg-chalkboard-110 dark:bg-chalkboard-80" />
)

export function HelpMenu(props: React.PropsWithChildren) {
  const location = useLocation()
  const filePath = useAbsoluteFilePath()
  const isInProject = location.pathname.includes(paths.FILE)
  const navigate = useNavigate()
  const { settings } = useSettingsAuthContext()

  return (
    <Popover className="relative">
      <Popover.Button className="grid p-0 m-0 border-none rounded-full place-content-center">
        <CustomIcon
          name="questionMark"
          className="rounded-full w-7 h-7 bg-chalkboard-110 dark:bg-chalkboard-80 text-chalkboard-10"
        />
        <span className="sr-only">Help and resources</span>
        <Tooltip position="top-right" wrapperClassName="ui-open:hidden">
          Help and resources
        </Tooltip>
      </Popover.Button>
      <Popover.Panel
        as="ul"
        className="absolute right-0 left-auto flex flex-col w-64 gap-1 p-0 py-2 m-0 mb-1 text-sm border border-solid rounded shadow-lg bottom-full align-stretch text-chalkboard-10 dark:text-inherit bg-chalkboard-110 dark:bg-chalkboard-100 border-chalkboard-110 dark:border-chalkboard-80"
      >
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
          href="https://zoo.dev/docs/kcl-samples"
          target="_blank"
          rel="noopener noreferrer"
        >
          KCL code samples
        </HelpMenuItem>
        <HelpMenuItem
          as="a"
          href="https://zoo.dev/docs/kcl"
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
        <HelpMenuItem
          as="button"
          onClick={() => {
            const targetPath = location.pathname.includes(paths.FILE)
              ? filePath + paths.SETTINGS
              : paths.HOME + paths.SETTINGS
            navigate(targetPath + '?tab=keybindings')
          }}
        >
          Keyboard shortcuts
        </HelpMenuItem>
        <HelpMenuItem
          as="button"
          onClick={() => {
            settings.send({
              type: 'set.app.onboardingStatus',
              data: {
                value: '',
                level: 'user',
              },
            })
            if (isInProject) {
              navigate('onboarding')
            } else {
              createAndOpenNewProject(navigate)
            }
          }}
        >
          Reset onboarding
        </HelpMenuItem>
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
        <a
          {...(props as React.ComponentProps<'a'>)}
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
