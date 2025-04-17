import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { Resizable } from 're-resizable'
import type { MouseEventHandler } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { ActionIcon } from '@src/components/ActionIcon'
import type { CustomIconName } from '@src/components/CustomIcon'
import { ModelingPane } from '@src/components/ModelingSidebar/ModelingPane'
import type { SidebarType } from '@src/components/ModelingSidebar/ModelingPanes'
import { sidebarPanes } from '@src/components/ModelingSidebar/ModelingPanes'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useKclContext } from '@src/lang/KclProvider'
import { SIDEBAR_BUTTON_SUFFIX } from '@src/lib/constants'
import { useSettings } from '@src/machines/appMachine'
import { onboardingPaths } from '@src/routes/Onboarding/paths'
import { getPlatformString } from '@src/lib/utils'
import { BadgeInfoComputed, ModelingPaneButton } from './ModelingSidebarButton'

interface ModelingSidebarProps {
  paneOpacity: '' | 'opacity-20' | 'opacity-40'
}

export function ModelingSidebar({ paneOpacity }: ModelingSidebarProps) {
  const kclContext = useKclContext()
  const settings = useSettings()
  const onboardingStatus = settings.app.onboardingStatus
  const { send, context } = useModelingContext()
  const pointerEventsCssClass =
    onboardingStatus.current === onboardingPaths.CAMERA ||
    context.store?.openPanes.length === 0
      ? 'pointer-events-none '
      : 'pointer-events-auto '
  const showDebugPanel = settings.app.showDebugPanel

  const paneCallbackProps = useMemo(
    () => ({
      kclContext,
      settings,
      platform: getPlatformString(),
    }),
    [kclContext.diagnostics, settings]
  )

  //   // Filter out the debug panel if it's not supposed to be shown
  //   // TODO: abstract out for allowing user to configure which panes to show
  const filteredPanes = useMemo(
    () =>
      (showDebugPanel.current
        ? sidebarPanes
        : sidebarPanes.filter((pane) => pane.id !== 'debug')
      ).filter(
        (pane) =>
          !pane.hide ||
          (pane.hide instanceof Function && !pane.hide(paneCallbackProps))
      ),
    [sidebarPanes, paneCallbackProps]
  )

  const paneBadgeMap: Record<SidebarType, BadgeInfoComputed> = useMemo(() => {
    return filteredPanes.reduce(
      (acc, pane) => {
        if (pane.showBadge) {
          acc[pane.id] = {
            value: pane.showBadge.value(paneCallbackProps),
            onClick: pane.showBadge.onClick,
            className: pane.showBadge.className,
            title: pane.showBadge.title,
          }
        }
        return acc
      },
      {} as Record<SidebarType, BadgeInfoComputed>
    )
  }, [paneCallbackProps])

  // Clear any hidden panes from the `openPanes` array
  useEffect(() => {
    const panesToReset: SidebarType[] = []

    sidebarPanes.forEach((pane) => {
      if (
        pane.hide === true ||
        (pane.hide instanceof Function && pane.hide(paneCallbackProps))
      ) {
        panesToReset.push(pane.id)
      }
    })

    if (panesToReset.length > 0) {
      send({
        type: 'Set context',
        data: {
          openPanes: context.store?.openPanes.filter(
            (pane) => !panesToReset.includes(pane)
          ),
        },
      })
    }
  }, [settings.app.showDebugPanel])

  const togglePane = useCallback(
    (newPane: SidebarType) => {
      send({
        type: 'Set context',
        data: {
          openPanes: context.store?.openPanes.includes(newPane)
            ? context.store?.openPanes.filter((pane) => pane !== newPane)
            : [...context.store?.openPanes, newPane],
        },
      })
    },
    [context.store?.openPanes, send]
  )

  return (
    <Resizable
      className={`group flex-1 flex flex-col z-10 my-2 pr-1 ${paneOpacity} ${pointerEventsCssClass}`}
      defaultSize={{
        width: '550px',
        height: 'auto',
      }}
      minWidth={200}
      maxWidth={window.innerWidth - 10}
      handleWrapperClass="sidebar-resize-handles"
      handleClasses={{
        right:
          (context.store?.openPanes.length === 0 ? 'hidden ' : 'block ') +
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
      <div id="app-sidebar" className="flex flex-row h-full">
        <ul
          className={
            (context.store?.openPanes.length === 0 ? 'rounded-r ' : '') +
            'relative z-[2] pointer-events-auto p-0 col-start-1 col-span-1 h-fit w-fit flex flex-col ' +
            'bg-chalkboard-10 border border-solid border-chalkboard-30 dark:bg-chalkboard-90 dark:border-chalkboard-80 group-focus-within:border-primary dark:group-focus-within:border-chalkboard-50 shadow-sm '
          }
        >
          <ul
            id="pane-buttons-section"
            className={
              'w-fit p-2 flex flex-col gap-2 ' +
              (context.store?.openPanes.length >= 1 ? 'pr-0.5' : '')
            }
          >
            {filteredPanes.map((pane) => (
              <ModelingPaneButton
                key={pane.id}
                paneConfig={pane}
                paneIsOpen={context.store?.openPanes.includes(pane.id)}
                onClick={() => togglePane(pane.id)}
                aria-pressed={context.store?.openPanes.includes(pane.id)}
                showBadge={paneBadgeMap[pane.id]}
              />
            ))}
          </ul>
        </ul>
        <ul
          id="pane-section"
          className={
            'ml-[-1px] col-start-2 col-span-1 flex flex-col items-stretch gap-2 ' +
            (context.store?.openPanes.length >= 1 ? `w-full` : `hidden`)
          }
        >
          {filteredPanes
            .filter((pane) => context?.store.openPanes.includes(pane.id))
            .map((pane) => (
              <ModelingPane
                key={pane.id}
                icon={pane.icon}
                title={pane.sidebarName}
                onClose={() => {}}
                id={`${pane.id}-pane`}
              >
                {pane.Content instanceof Function ? (
                  <pane.Content
                    id={pane.id}
                    onClose={() => togglePane(pane.id)}
                  />
                ) : (
                  pane.Content
                )}
              </ModelingPane>
            ))}
        </ul>
      </div>
    </Resizable>
  )
}
