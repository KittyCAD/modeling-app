import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Menu } from '@headlessui/react'
import type { PropsWithChildren } from 'react'

import { ActionIcon } from '@src/components/ActionIcon'
import { editorShortcutMeta } from '@src/components/ModelingSidebar/ModelingPanes/KclEditorPane'
import { useConvertToVariable } from '@src/hooks/useToolbarGuards'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { commandBarActor } from '@src/machines/commandBarMachine'

import styles from './KclEditorMenu.module.css'

export const KclEditorMenu = ({ children }: PropsWithChildren) => {
  const { enable: convertToVarEnabled, handleClick: handleConvertToVarClick } =
    useConvertToVariable()

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
              onClick={() => {
                kclManager.format().catch(reportRejection)
              }}
              className={styles.button}
            >
              <span>Format code</span>
              <small>{editorShortcutMeta.formatCode.display}</small>
            </button>
          </Menu.Item>
          {convertToVarEnabled && (
            <Menu.Item>
              <button
                onClick={() => {
                  handleConvertToVarClick().catch(reportRejection)
                }}
                className={styles.button}
              >
                <span>Convert to Variable</span>
                <small>{editorShortcutMeta.convertToVariable.display}</small>
              </button>
            </Menu.Item>
          )}
          <Menu.Item>
            <a
              className={styles.button}
              href="https://zoo.dev/docs/kcl"
              target="_blank"
              rel="noopener noreferrer"
              onClick={openExternalBrowserIfDesktop()}
            >
              <span>Read the KCL docs</span>
              <small>
                zoo.dev
                <FontAwesomeIcon
                  icon={faArrowUpRightFromSquare}
                  className="ml-1 align-text-top"
                  width={12}
                />
              </small>
            </a>
          </Menu.Item>
          <Menu.Item>
            <button
              onClick={() => {
                commandBarActor.send({
                  type: 'Find and select command',
                  data: {
                    groupId: 'code',
                    name: 'open-kcl-example',
                  },
                })
              }}
              className={styles.button}
            >
              <span>Load a sample model</span>
            </button>
          </Menu.Item>
          <Menu.Item>
            <a
              className={styles.button}
              href="https://zoo.dev/docs/kcl-samples"
              target="_blank"
              rel="noopener noreferrer"
              onClick={openExternalBrowserIfDesktop()}
            >
              <span>View all samples</span>
              <small>
                zoo.dev
                <FontAwesomeIcon
                  icon={faArrowUpRightFromSquare}
                  className="ml-1 align-text-top"
                  width={12}
                />
              </small>
            </a>
          </Menu.Item>
        </Menu.Items>
      </div>
    </Menu>
  )
}
