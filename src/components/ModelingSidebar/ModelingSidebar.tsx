import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { Resizable } from 're-resizable'
import { useCallback, useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useStore } from 'useStore'
import { Tab } from '@headlessui/react'
import {
  SidebarPane,
  SidebarType,
  bottomPanes,
  topPanes,
} from './ModelingPanes'
import Tooltip from 'components/Tooltip'
import { ActionIcon } from 'components/ActionIcon'
import styles from './ModelingSidebar.module.css'
import { ModelingPane } from './ModelingPane'
import { isTauri } from 'lib/isTauri'
import { Setting } from 'lib/settings/initialSettings'

const TOGGLABLE_PANE_IDS = ['debug', 'artifactMap'] as const

interface ModelingSidebarProps {
  paneOpacity: '' | 'opacity-20' | 'opacity-40'
}

export function ModelingSidebar({ paneOpacity }: ModelingSidebarProps) {
  const { settings } = useSettingsAuthContext()
  const onboardingStatus = settings.context.app.onboardingStatus
  const { openPanes, buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
    openPanes: s.openPanes,
  }))
  const pointerEventsCssClass =
    buttonDownInStream ||
    onboardingStatus.current === 'camera' ||
    openPanes.length === 0
      ? 'pointer-events-none '
      : 'pointer-events-auto '

  return (
    <Resizable
      className={`flex-1 flex flex-col z-10 my-2 pr-1 ${paneOpacity} ${pointerEventsCssClass}`}
      defaultSize={{
        width: '550px',
        height: 'auto',
      }}
      minWidth={200}
      maxWidth={800}
      handleClasses={{
        right:
          (openPanes.length === 0 ? 'hidden ' : 'block ') +
          'translate-x-1/2 hover:bg-chalkboard-10 hover:dark:bg-chalkboard-110 bg-transparent transition-colors duration-75 transition-ease-out delay-100 ',
        left: 'hidden',
        top: 'hidden',
        topLeft: 'hidden',
        topRight: 'hidden',
        bottom: 'hidden',
        bottomLeft: 'hidden',
        bottomRight: 'hidden',
      }}
    >
      <div id="modeling-sidebar" className={styles.grid + ' flex-1'}>
        <ModelingSidebarSection panes={topPanes} />
        <ModelingSidebarSection panes={bottomPanes} alignButtons="end" />
      </div>
    </Resizable>
  )
}

interface ModelingSidebarSectionProps {
  panes: SidebarPane[]
  alignButtons?: 'start' | 'end'
}

function ModelingSidebarSection({
  panes,
  alignButtons = 'start',
}: ModelingSidebarSectionProps) {
  const { settings } = useSettingsAuthContext()
  const { showDebugPanel, showArtifactMapPanel: showSceneTreePanel } =
    settings.context.modeling
  const togglablePanes: [string, Setting<boolean>][] = [
    ['debug', showDebugPanel],
    ['artifactMap', showSceneTreePanel],
  ]
  const { openPanes, setOpenPanes } = useStore((s) => ({
    openPanes: s.openPanes,
    setOpenPanes: s.setOpenPanes,
  }))

  // Filter out each panel controlled by a setting if it's not supposed to be shown
  const filteredPanes = panes
    .filter((pane) =>
      togglablePanes.every(
        ([id, showSetting]) => showSetting.current || id !== pane.id
      )
    )
    .filter(
      (pane) =>
        !pane.hideOnPlatform ||
        (isTauri()
          ? pane.hideOnPlatform === 'web'
          : pane.hideOnPlatform === 'desktop')
    )
  const paneIds = filteredPanes.map((pane) => pane.id)

  const foundOpenPane = openPanes.find((pane) => paneIds.includes(pane))
  const [currentPane, setCurrentPane] = useState(
    foundOpenPane || ('none' as SidebarType | 'none')
  )

  const togglePane = useCallback(
    (newPane: SidebarType | 'none') => {
      if (newPane === 'none') {
        setOpenPanes(openPanes.filter((p) => p !== currentPane))
        setCurrentPane('none')
      } else if (newPane === currentPane) {
        setCurrentPane('none')
        setOpenPanes(openPanes.filter((p) => p !== newPane))
      } else {
        setOpenPanes([...openPanes.filter((p) => p !== currentPane), newPane])
        setCurrentPane(newPane)
      }
    },
    [openPanes, setOpenPanes, currentPane, setCurrentPane]
  )

  useEffect(() => {
    if (
      !showDebugPanel.current &&
      currentPane === 'debug' &&
      openPanes.includes('debug')
    ) {
      togglePane('debug')
    } else if (
      !showSceneTreePanel.current &&
      currentPane === 'artifactMap' &&
      openPanes.includes('artifactMap')
    ) {
      togglePane('artifactMap')
    }
  }, [
    showDebugPanel.current,
    showSceneTreePanel.current,
    togglePane,
    openPanes,
  ])

  return (
    <Tab.Group
      vertical
      selectedIndex={
        currentPane === 'none' ? 0 : paneIds.indexOf(currentPane) + 1
      }
      onChange={(index) => {
        const newPane = index === 0 ? 'none' : paneIds[index - 1]
        togglePane(newPane)
      }}
    >
      <Tab.List
        className={
          'pointer-events-auto ' +
          (alignButtons === 'start'
            ? 'justify-start self-start'
            : 'justify-end self-end') +
          (currentPane === 'none'
            ? ' rounded-r focus-within:!border-primary/50'
            : ' border-r-0') +
          ' p-2 col-start-1 col-span-1 h-fit w-fit flex flex-col items-start gap-2 bg-chalkboard-10 border border-solid border-chalkboard-30 dark:bg-chalkboard-90 dark:border-chalkboard-80 ' +
          (openPanes.length === 1 && currentPane === 'none' ? 'pr-0.5' : '')
        }
      >
        <Tab key="none" className="sr-only">
          No panes open{' '}
        </Tab>
        {filteredPanes.map((pane) => (
          <ModelingPaneButton
            key={pane.id}
            paneConfig={pane}
            currentPane={currentPane}
            togglePane={() => togglePane(pane.id)}
          />
        ))}
      </Tab.List>
      <Tab.Panels
        as="article"
        className={
          'col-start-2 col-span-1 ' +
          (openPanes.length === 1
            ? currentPane !== 'none'
              ? `row-start-1 row-end-3`
              : `hidden`
            : ``)
        }
      >
        <Tab.Panel key="none" />
        {filteredPanes.map((pane) => (
          <Tab.Panel key={pane.id} className="h-full">
            <ModelingPane
              id={`${pane.id}-pane`}
              title={pane.title}
              Menu={pane.Menu}
            >
              {pane.Content instanceof Function ? (
                <pane.Content />
              ) : (
                pane.Content
              )}
            </ModelingPane>
          </Tab.Panel>
        ))}
      </Tab.Panels>
    </Tab.Group>
  )
}

interface ModelingPaneButtonProps {
  paneConfig: SidebarPane
  currentPane: SidebarType | 'none'
  togglePane: () => void
}

function ModelingPaneButton({
  paneConfig,
  currentPane,
  togglePane,
}: ModelingPaneButtonProps) {
  useHotkeys(paneConfig.keybinding, togglePane, {
    scopes: ['modeling'],
  })

  return (
    <Tab
      key={paneConfig.id}
      className="pointer-events-auto flex items-center justify-center border-transparent dark:border-transparent p-0 m-0 rounded-sm !outline-none"
      onClick={togglePane}
    >
      <ActionIcon
        icon={paneConfig.icon}
        className="p-1"
        size="sm"
        iconClassName={
          paneConfig.id === currentPane
            ? ' !text-chalkboard-10'
            : '!text-chalkboard-80 dark:!text-chalkboard-30'
        }
        bgClassName={
          'rounded-sm ' +
          (paneConfig.id === currentPane ? '!bg-primary' : '!bg-transparent')
        }
      />
      <Tooltip position="right" hoverOnly delay={800}>
        <span>{paneConfig.title}</span>
        <br />
        <span className="sr-only">, Shortcut: </span>
        <span className="text-xs capitalize">{paneConfig.keybinding}</span>
      </Tooltip>
    </Tab>
  )
}
