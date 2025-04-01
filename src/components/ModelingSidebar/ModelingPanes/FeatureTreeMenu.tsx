import { Menu } from '@headlessui/react'
import { ActionIcon } from 'components/ActionIcon'
import { commandBarActor } from 'machines/commandBarMachine'
import { PropsWithChildren } from 'react'

import styles from './KclEditorMenu.module.css'

export const FeatureTreeMenu = ({ children }: PropsWithChildren) => {
  return (
    <Menu>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="relative"
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (e.eventPhase === 3 && target.closest('a') === null) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      >
        <Menu.Button className="!p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 ui-open:!border-primary dark:ui-open:!border-chalkboard-70 !outline-none">
          <ActionIcon
            icon="three-dots"
            className="p-1"
            size="sm"
            bgClassName="bg-transparent dark:bg-transparent"
            iconClassName={'!text-chalkboard-90 dark:!text-chalkboard-40'}
          />
        </Menu.Button>
        <Menu.Items className="absolute right-0 left-auto w-72 flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch px-0 py-1 bg-chalkboard-10 dark:bg-chalkboard-100 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50">
          <Menu.Item>
            <button
              onClick={() =>
                commandBarActor.send({
                  type: 'Find and select command',
                  data: {
                    groupId: 'modeling',
                    name: 'event.parameter.create',
                  },
                })
              }
              className={styles.button}
            >
              <span>Create parameter</span>
            </button>
          </Menu.Item>
        </Menu.Items>
      </div>
    </Menu>
  )
}
