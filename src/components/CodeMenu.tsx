import { Menu } from '@headlessui/react'
import { PropsWithChildren } from 'react'
import { faEllipsis } from '@fortawesome/free-solid-svg-icons'
import { ActionIcon } from './ActionIcon'
import { useStore } from 'useStore'
import styles from './CodeMenu.module.css'
import { useConvertToVariable } from 'hooks/useToolbarGuards'
import { editorShortcutMeta } from './TextEditor'

export const CodeMenu = ({ children }: PropsWithChildren) => {
  const { formatCode } = useStore((s) => ({
    formatCode: s.formatCode,
  }))
  const { enable: convertToVarEnabled, handleClick: handleConvertToVarClick } =
    useConvertToVariable()

  return (
    <Menu>
      <div
        className="relative"
        onClick={(e) => {
          if (e.eventPhase === 3) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      >
        <Menu.Button className="p-0 border-none relative">
          <ActionIcon
            icon={faEllipsis}
            bgClassName={
              'bg-chalkboard-20 dark:bg-chalkboard-110 hover:bg-liquid-10/50 hover:dark:bg-chalkboard-90 ui-active:bg-chalkboard-80 ui-active:dark:bg-chalkboard-90  rounded'
            }
            iconClassName={'text-chalkboard-90 dark:text-chalkboard-40'}
          />
        </Menu.Button>
        <Menu.Items className="absolute right-0 left-auto w-72 flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch px-0 py-1 bg-chalkboard-10 dark:bg-chalkboard-90 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50">
          <Menu.Item>
            <button onClick={() => formatCode()} className={styles.button}>
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
        </Menu.Items>
      </div>
    </Menu>
  )
}
