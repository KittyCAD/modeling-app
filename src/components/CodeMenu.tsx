import { Menu } from '@headlessui/react'
import { PropsWithChildren } from 'react'
import {
  faArrowUpRightFromSquare,
  faEllipsis,
} from '@fortawesome/free-solid-svg-icons'
import { ActionIcon } from './ActionIcon'
import styles from './CodeMenu.module.css'
import { useConvertToVariable } from 'hooks/useToolbarGuards'
import { editorShortcutMeta } from './TextEditor'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { kclManager } from 'lang/KclSinglton'

export const CodeMenu = ({ children }: PropsWithChildren) => {
  const { enable: convertToVarEnabled, handleClick: handleConvertToVarClick } =
    useConvertToVariable()

  return (
    <Menu>
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
        <Menu.Button className="p-0 border-none relative">
          <ActionIcon
            icon={faEllipsis}
            className='p-1'
            size='sm'
            bgClassName={
              'bg-chalkboard-20 dark:bg-chalkboard-110 hover:bg-energy-10/50 hover:dark:bg-chalkboard-90 ui-active:bg-chalkboard-80 ui-active:dark:bg-chalkboard-90 rounded-sm'
            }
            iconClassName={'text-chalkboard-90 dark:text-chalkboard-40'}
          />
        </Menu.Button>
        <Menu.Items className="absolute right-0 left-auto w-72 flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch px-0 py-1 bg-chalkboard-10 dark:bg-chalkboard-90 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50">
          <Menu.Item>
            <button
              onClick={() => kclManager.format()}
              className={styles.button}
            >
              <span>Format code</span>
              <small>{editorShortcutMeta.formatCode.display}</small>
            </button>
          </Menu.Item>
          {convertToVarEnabled && (
            <Menu.Item>
              <button
                onClick={handleConvertToVarClick}
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
              href="https://github.com/KittyCAD/modeling-app/blob/main/docs/kcl/std.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>Read the KCL docs</span>
              <small>
                On GitHub
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
