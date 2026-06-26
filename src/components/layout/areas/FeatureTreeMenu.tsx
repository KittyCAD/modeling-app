import { Menu } from '@headlessui/react'

import { useApp } from '@src/lib/boot'

import Tooltip from '@src/components/Tooltip'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { isDesktop } from '@src/lib/isDesktop'
import styles from './KclEditorMenu.module.css'

export const FeatureTreeMenu = () => {
  const { commands } = useApp()
  return (
    <HeaderMenu>
      <Menu.Item>
        <button
          type="button"
          onClick={() =>
            commands.send({
              type: 'Find and select command',
              data: {
                groupId: 'code',
                name: 'parameter.create',
              },
            })
          }
          className={styles.button}
        >
          <span>Create parameter</span>
        </button>
      </Menu.Item>
      <Menu.Item>
        <button
          type="button"
          onClick={() =>
            commands.send({
              type: 'Find and select command',
              data: {
                groupId: 'code',
                name: 'Insert',
              },
            })
          }
          disabled={!isDesktop()}
          className={styles.button}
        >
          <span>Insert from a file</span>
          {!isDesktop() && (
            <Tooltip position="right">
              Available only in the desktop app
            </Tooltip>
          )}
        </button>
      </Menu.Item>
    </HeaderMenu>
  )
}
