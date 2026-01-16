import { Menu } from '@headlessui/react'
import type { PropsWithChildren } from 'react'
import { ActionIcon } from '@src/components/ActionIcon'
import { useConvertToVariable } from '@src/hooks/useToolbarGuards'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { useSingletons } from '@src/lib/singletons'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import toast from 'react-hot-toast'
import styles from './KclEditorMenu.module.css'
import { useEffect, useRef } from 'react'
import { reportRejection, trap } from '@src/lib/trap'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { CustomIcon } from '@src/components/CustomIcon'
import { kclEditorActor } from '@src/machines/kclEditorMachine'

type Singletons = ReturnType<typeof useSingletons>

export const editorShortcutMeta = {
  formatCode: {
    display: 'Alt + Shift + F',
  },
  convertToVariable: {
    codeMirror: 'Ctrl-Shift-c',
    display: 'Ctrl + Shift + C',
  },
}

export const KclEditorPane = (props: AreaTypeComponentProps) => {
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="code"
        title={props.layout.label}
        Menu={KclEditorMenu}
        onClose={props.onClose}
      />
      <KclEditorPaneContents />
    </LayoutPanel>
  )
}

export const KclEditorPaneContents = () => {
  const { kclManager } = useSingletons()
  const editorParent = useRef<HTMLDivElement>(null)
  useEffect(() => {
    kclEditorActor.send({ type: 'setKclEditorMounted', data: true })
    editorParent.current?.appendChild(kclManager.editorView.dom)

    return () =>
      kclEditorActor.send({ type: 'setKclEditorMounted', data: false })
  }, [])

  return (
    <div className="relative">
      <div
        id="code-mirror-override"
        className="absolute inset-0 pr-1"
        ref={editorParent}
      />
    </div>
  )
}

function copyKclCodeToClipboard(kclManager: Singletons['kclManager']) {
  if (!kclManager.codeSignal.value) {
    toast.error('No code available to copy')
    return
  }

  if (!globalThis?.navigator?.clipboard?.writeText) {
    toast.error('Clipboard functionality not available in your browser')
    return
  }

  navigator.clipboard
    .writeText(kclManager.codeSignal.value)
    .then(() => toast.success(`Copied current file's code to clipboard`))
    .catch((e) =>
      trap(new Error(`Failed to copy code to clipboard: ${e.message}`))
    )
}

export const KclEditorMenu = ({ children }: PropsWithChildren) => {
  const { commandBarActor, kclManager, settingsActor } = useSingletons()
  const { enable: convertToVarEnabled, handleClick: handleConvertToVarClick } =
    useConvertToVariable(kclManager)

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
          <Menu.Item>
            <button
              onClick={() => copyKclCodeToClipboard(kclManager)}
              className={styles.button}
            >
              <span>Copy code</span>
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
              href={withSiteBaseURL('/docs/kcl-lang')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openExternalBrowserIfDesktop()}
            >
              <span>Read the KCL docs</span>
              <small>
                zoo.dev
                <CustomIcon
                  name="link"
                  className="inline-block ml-1 text-align-top w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
                />
              </small>
            </a>
          </Menu.Item>
          <Menu.Item>
            <button
              onClick={() => {
                const currentProject =
                  settingsActor.getSnapshot().context.currentProject
                commandBarActor.send({
                  type: 'Find and select command',
                  data: {
                    name: 'add-kcl-file-to-project',
                    groupId: 'application',
                    argDefaultValues: {
                      method: 'existingProject',
                      projectName: currentProject?.name,
                    },
                  },
                })
              }}
              className={styles.button}
            >
              <span>Add file to project</span>
            </button>
          </Menu.Item>
          <Menu.Item>
            <a
              className={styles.button}
              href={withSiteBaseURL('/docs/kcl-samples')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openExternalBrowserIfDesktop()}
            >
              <span>View all samples</span>
              <small>
                zoo.dev
                <CustomIcon
                  name="link"
                  className="inline-block ml-1 text-align-top w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
                />
              </small>
            </a>
          </Menu.Item>
        </Menu.Items>
      </div>
    </Menu>
  )
}
