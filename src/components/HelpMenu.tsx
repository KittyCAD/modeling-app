import { Popover } from '@headlessui/react'
import Tooltip from './Tooltip'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { CustomIcon } from './CustomIcon'
import { useNavigate } from 'react-router-dom'

const HelpMenuDivider = () => (
  <div className="h-[1px] bg-chalkboard-110 dark:bg-chalkboard-80" />
)

export function HelpMenu(props: React.PropsWithChildren) {
  const navigate = useNavigate()
  const { settings } = useSettingsAuthContext()

  return (
    <Popover className="relative">
      <Popover.Button className="border-none p-0 m-0 rounded-full grid place-content-center">
        <CustomIcon
          name="questionMark"
          className="w-7 h-7 rounded-full bg-chalkboard-110 dark:bg-chalkboard-80 text-chalkboard-10"
        />
        <Tooltip position="top" className="ui-open:hidden">
          Help and resources
        </Tooltip>
      </Popover.Button>
      <Popover.Panel
        as="ul"
        className="absolute right-0 left-auto bottom-full mb-1 w-64 py-2 flex flex-col gap-1 align-stretch text-chalkboard-10 dark:text-inherit bg-chalkboard-110 dark:bg-chalkboard-100 rounded shadow-lg border border-solid border-chalkboard-110 dark:border-chalkboard-80 text-sm m-0 p-0"
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
            settings.send({
              type: 'set.app.onboardingStatus',
              data: {
                value: '',
                level: 'user',
              },
            })
            navigate('onboarding')
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
    <li className="m-0 p-0">
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
