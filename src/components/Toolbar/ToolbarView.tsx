import { ActionButton } from '@src/components/ActionButton'
import { ActionButtonDropdown } from '@src/components/ActionButtonDropdown'
import { ActionButtonRecentDropdown } from '@src/components/ActionButtonRecentDropdown'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import Tooltip, {
  RICH_TOOLTIP_SURFACE_CLASS_NAME,
} from '@src/components/Tooltip'
import { useRichTooltipContent } from '@src/hooks/useRichTooltipContent'
import { type HotkeySequence, hotkeyDisplay } from '@src/lib/hotkeys'
import { isDesktop } from '@src/lib/isDesktop'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import {
  getDefaultRecentToolbarItemIds,
  getToolbarDropdownDisplay,
  promoteRecentToolbarItemId,
  recordRecentToolbarItemId,
  resolveRecentToolbarItems,
} from '@src/lib/toolbarPresentation'
import type { Platform } from '@src/lib/utils'
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/** Resolved actions and eligibility come from the owning host; this layer owns only toolbar presentation. */
export interface ToolbarViewItem {
  id: string
  title: string
  description: string
  tooltipTitle?: string
  icon?: CustomIconName
  iconColor?: string
  alwaysDark?: boolean
  status: 'available' | 'unavailable' | 'kcl-only' | 'experimental'
  disabled?: boolean
  disabledReason?: string
  isActive?: boolean
  showTitle?: boolean
  hotkey?: HotkeySequence
  extraInfo?: string
  links: { label: string; url: string }[]
  onClick: (event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>) => void
}
export interface ToolbarViewDropdown {
  id: string
  array: ToolbarViewItem[]
  display?: 'default' | 'recent'
  visibleItemCount?: number
  defaultVisibleItemIds?: string[]
}
export type ToolbarViewEntry = ToolbarViewItem | ToolbarViewDropdown | 'break'
function isToolbarViewDropdown(
  item: ToolbarViewItem | ToolbarViewDropdown
): item is ToolbarViewDropdown {
  return 'array' in item
}

export function ToolbarView({
  items: currentModeItems,
  mode,
  platform,
  disabled = false,
  disableAllButtons = false,
  idPrefix = '',
  children,
}: {
  items: readonly ToolbarViewEntry[]
  mode: string
  platform: Platform
  disabled?: boolean
  disableAllButtons?: boolean
  idPrefix?: string
  children?: ReactNode
}) {
  const iconClassName =
    'group-disabled:text-chalkboard-50 !text-inherit dark:group-enabled:group-hover:!text-inherit'
  const bgClassName = '!bg-transparent'
  const buttonBgClassName =
    'bg-chalkboard-transparent dark:bg-transparent disabled:bg-transparent dark:disabled:bg-transparent enabled:hover:bg-chalkboard-10 dark:enabled:hover:bg-chalkboard-100 pressed:!bg-primary pressed:enabled:hover:!text-chalkboard-10'
  const buttonBorderClassName = '!border-transparent'
  const toolbarButtonsRef = useRef<HTMLUListElement>(null)
  const { showRichContent, handleMouseEnter, handleMouseLeave } =
    useRichTooltipContent()
  const tooltipContentClassName = !showRichContent
    ? ''
    : `${RICH_TOOLTIP_SURFACE_CLASS_NAME} !max-w-none`
  // To remember the last selected item in a standard ActionButtonDropdown
  const [lastSelectedMultiActionItem, setLastSelectedMultiActionItem] =
    useState(
      new Map<
        number /* index in currentModeItems */,
        number /* index in maybeIconConfig */
      >()
    )
  const [, setRecentDropdownItemIds] = useState(new Map<string, string[]>())
  const [visibleRecentDropdownItemIds, setVisibleRecentDropdownItemIds] =
    useState(new Map<string, string[]>())

  const rememberRecentDropdownItem = useCallback(
    (
      dropdown: ToolbarViewDropdown,
      itemId: string,
      shouldPromoteIntoVisibleItems: boolean
    ) => {
      setRecentDropdownItemIds((previous) => {
        const next = new Map(previous)
        const nextRecentItemIds = recordRecentToolbarItemId(
          itemId,
          next.get(dropdown.id) ?? [],
          dropdown
        )
        next.set(dropdown.id, nextRecentItemIds)

        if (shouldPromoteIntoVisibleItems) {
          setVisibleRecentDropdownItemIds((previousVisible) => {
            const nextVisible = new Map(previousVisible)
            nextVisible.set(
              dropdown.id,
              promoteRecentToolbarItemId(
                itemId,
                nextVisible.get(dropdown.id) ??
                  getDefaultRecentToolbarItemIds(dropdown),
                nextRecentItemIds,
                dropdown
              )
            )
            return nextVisible
          })
        }

        return next
      })
    },
    []
  )

  return (
    <div
      role="toolbar"
      aria-label="Modeling tools"
      aria-disabled={disabled}
      data-current-mode={mode}
      data-testid="toolbar"
      data-onboarding-id="toolbar"
      className={`toolbar pointer-events-auto z-[19] max-w-full whitespace-nowrap px-2 py-1 mx-auto bg-chalkboard-10 dark:bg-chalkboard-90 relative border border-chalkboard-30 dark:border-chalkboard-80 border-t-0 shadow-sm ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <ul
        ref={toolbarButtonsRef}
        className={`has-[[aria-expanded=true]]:!pointer-events-none m-0 py-1 rounded-l-sm flex flex-wrap gap-1.5 items-center ${
          disabled ? 'pointer-events-none' : ''
        }`}
      >
        {/* A menu item will either be a vertical line break, a button with a dropdown, or a single button */}
        {currentModeItems.map((maybeIconConfig, i) => {
          // Vertical Line Break
          if (maybeIconConfig === 'break') {
            return (
              <div
                key={'break-' + i}
                className="h-5 w-[1px] block bg-chalkboard-30 dark:bg-chalkboard-80"
              />
            )
          } else if (isToolbarViewDropdown(maybeIconConfig)) {
            if (getToolbarDropdownDisplay(maybeIconConfig) === 'recent') {
              const visibleItemIds =
                visibleRecentDropdownItemIds.get(maybeIconConfig.id) ??
                getDefaultRecentToolbarItemIds(maybeIconConfig)
              const { visibleItems } = resolveRecentToolbarItems(
                maybeIconConfig,
                visibleItemIds
              )

              return (
                <ActionButtonRecentDropdown
                  key={maybeIconConfig.id}
                  name={maybeIconConfig.id}
                  dropdownTooltipText="More constraints"
                  platform={platform}
                  className={
                    (maybeIconConfig.array[0]?.alwaysDark
                      ? 'dark bg-chalkboard-90 '
                      : '!bg-transparent ') +
                    'group/wrapper ' +
                    buttonBorderClassName +
                    ' relative group'
                  }
                  menuItems={maybeIconConfig.array.map((itemConfig) => ({
                    id: itemConfig.id,
                    label: itemConfig.title,
                    icon: itemConfig.icon,
                    iconColor: itemConfig.iconColor,
                    hotkey: itemConfig.hotkey,
                    onClick: (event) => {
                      rememberRecentDropdownItem(
                        maybeIconConfig,
                        itemConfig.id,
                        !visibleItems.some(
                          (visibleItem) => visibleItem.id === itemConfig.id
                        )
                      )
                      itemConfig.onClick(event)
                    },
                    disabled:
                      disableAllButtons ||
                      !['available', 'experimental'].includes(
                        itemConfig.status
                      ) ||
                      itemConfig.disabled === true,
                    status: itemConfig.status,
                  }))}
                >
                  {visibleItems.map((itemConfig, visibleIndex) => (
                    <div
                      className="relative"
                      key={itemConfig.id}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    >
                      <ActionButton
                        Element="button"
                        id={idPrefix + itemConfig.id}
                        data-testid={itemConfig.id}
                        data-onboarding-id={itemConfig.id}
                        iconStart={{
                          icon: itemConfig.icon,
                          iconColor: itemConfig.iconColor,
                          className: iconClassName,
                          bgClassName: bgClassName,
                        }}
                        className={
                          '!border-transparent !px-0 pressed:!text-chalkboard-10 pressed:enabled:hovered:!text-chalkboard-10 rounded-none ' +
                          (visibleIndex === 0 ? '!rounded-l-sm ' : '') +
                          (visibleIndex === visibleItems.length - 1
                            ? '!rounded-r-sm '
                            : '') +
                          buttonBgClassName
                        }
                        aria-pressed={itemConfig.isActive}
                        disabled={
                          disableAllButtons ||
                          !['available', 'experimental'].includes(
                            itemConfig.status
                          ) ||
                          itemConfig.disabled
                        }
                        name={itemConfig.title}
                        aria-label={itemConfig.title}
                        aria-description={itemConfig.description}
                        onClick={(event) => {
                          rememberRecentDropdownItem(
                            maybeIconConfig,
                            itemConfig.id,
                            false
                          )
                          itemConfig.onClick(event)
                        }}
                      >
                        <span
                          className={!itemConfig.showTitle ? 'sr-only' : ''}
                        >
                          {itemConfig.title}
                        </span>
                      </ActionButton>
                      <ToolbarItemTooltip
                        itemConfig={itemConfig}
                        wrapperClassName="ui-open:!hidden"
                        contentClassName={tooltipContentClassName}
                      >
                        {showRichContent ? (
                          <ToolbarItemTooltipRichContent
                            itemConfig={itemConfig}
                            platform={platform}
                          />
                        ) : (
                          <ToolbarItemTooltipShortContent
                            status={itemConfig.status}
                            title={itemConfig.tooltipTitle ?? itemConfig.title}
                            hotkey={itemConfig.hotkey}
                            platform={platform}
                          />
                        )}
                      </ToolbarItemTooltip>
                    </div>
                  ))}
                </ActionButtonRecentDropdown>
              )
            }

            const selectedIcon =
              maybeIconConfig.array.find((c) => c.isActive) ||
              maybeIconConfig.array[lastSelectedMultiActionItem.get(i) ?? 0]

            return (
              <ActionButtonDropdown
                Element="button"
                key={selectedIcon.id}
                data-testid={selectedIcon.id + '-dropdown'}
                data-onboarding-id={selectedIcon.id + '-dropdown'}
                id={idPrefix + selectedIcon.id + '-dropdown'}
                name={maybeIconConfig.id}
                platform={platform}
                className={
                  (maybeIconConfig.array[0].alwaysDark
                    ? 'dark bg-chalkboard-90 '
                    : '!bg-transparent ') +
                  'group/wrapper ' +
                  buttonBorderClassName +
                  ' relative group !gap-0'
                }
                splitMenuItems={maybeIconConfig.array.map((itemConfig) => ({
                  id: itemConfig.id,
                  label: itemConfig.title,
                  icon: itemConfig.icon,
                  iconColor: itemConfig.iconColor,
                  hotkey: itemConfig.hotkey,
                  onClick: (event) => {
                    setLastSelectedMultiActionItem((previous) => {
                      const next = new Map(previous)
                      next.set(i, maybeIconConfig.array.indexOf(itemConfig))
                      return next
                    })
                    itemConfig.onClick(event)
                  },
                  disabled:
                    disableAllButtons ||
                    !['available', 'experimental'].includes(
                      itemConfig.status
                    ) ||
                    itemConfig.disabled === true,
                  status: itemConfig.status,
                }))}
              >
                <div
                  className="contents"
                  // Mouse events do not fire on disabled buttons
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                >
                  <ActionButton
                    Element="button"
                    id={idPrefix + selectedIcon.id}
                    data-testid={selectedIcon.id}
                    data-onboarding-id={selectedIcon.id}
                    iconStart={{
                      icon: selectedIcon.icon,
                      iconColor: selectedIcon.iconColor,
                      className: iconClassName,
                      bgClassName: bgClassName,
                    }}
                    className={
                      '!border-transparent !px-0 pressed:!text-chalkboard-10 pressed:enabled:hovered:!text-chalkboard-10 ' +
                      buttonBgClassName
                    }
                    aria-pressed={selectedIcon.isActive}
                    disabled={
                      disableAllButtons ||
                      !['available', 'experimental'].includes(
                        selectedIcon.status
                      ) ||
                      selectedIcon.disabled
                    }
                    name={selectedIcon.title}
                    aria-label={selectedIcon.title}
                    aria-description={selectedIcon.description}
                    onClick={(event) => selectedIcon.onClick(event)}
                  >
                    <span className={!selectedIcon.showTitle ? 'sr-only' : ''}>
                      {selectedIcon.title}
                    </span>
                    <ToolbarItemTooltip
                      itemConfig={selectedIcon}
                      wrapperClassName="ui-open:!hidden"
                      contentClassName={tooltipContentClassName}
                    >
                      {showRichContent ? (
                        <ToolbarItemTooltipRichContent
                          itemConfig={selectedIcon}
                          platform={platform}
                        />
                      ) : (
                        <ToolbarItemTooltipShortContent
                          status={selectedIcon.status}
                          title={
                            selectedIcon.tooltipTitle ?? selectedIcon.title
                          }
                          hotkey={selectedIcon.hotkey}
                          platform={platform}
                        />
                      )}
                    </ToolbarItemTooltip>
                  </ActionButton>
                </div>
              </ActionButtonDropdown>
            )
          }
          const itemConfig = maybeIconConfig

          // A single button
          return (
            <div
              className={`relative ${itemConfig.alwaysDark ? ' dark bg-chalkboard-90 ' : ''}`}
              key={itemConfig.id}
              // Mouse events do not fire on disabled buttons
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <ActionButton
                Element="button"
                key={itemConfig.id}
                id={idPrefix + itemConfig.id}
                data-testid={itemConfig.id}
                data-onboarding-id={itemConfig.id}
                iconStart={{
                  icon: itemConfig.icon,
                  iconColor: itemConfig.iconColor,
                  className: iconClassName,
                  bgClassName: bgClassName,
                }}
                className={
                  'pressed:!text-chalkboard-10 pressed:enabled:hovered:!text-chalkboard-10 ' +
                  buttonBorderClassName +
                  ' ' +
                  buttonBgClassName +
                  (!itemConfig.showTitle ? ' !px-0' : '')
                }
                name={itemConfig.title}
                aria-label={itemConfig.title}
                // aria-description is still in ARIA 1.3 draft.

                aria-description={itemConfig.description}
                aria-pressed={itemConfig.isActive}
                disabled={
                  disableAllButtons ||
                  !['available', 'experimental'].includes(itemConfig.status) ||
                  itemConfig.disabled
                }
                onClick={(event) => itemConfig.onClick(event)}
              >
                <span className={!itemConfig.showTitle ? 'sr-only' : ''}>
                  {itemConfig.title}
                </span>
              </ActionButton>
              <ToolbarItemTooltip
                itemConfig={itemConfig}
                contentClassName={tooltipContentClassName}
              >
                {showRichContent ? (
                  <ToolbarItemTooltipRichContent
                    itemConfig={itemConfig}
                    platform={platform}
                  />
                ) : (
                  <ToolbarItemTooltipShortContent
                    status={itemConfig.status}
                    title={itemConfig.tooltipTitle ?? itemConfig.title}
                    hotkey={itemConfig.hotkey}
                    platform={platform}
                  />
                )}
              </ToolbarItemTooltip>
            </div>
          )
        })}
      </ul>
      <div className="flex flex-col items-center absolute top-full left-1/2 -translate-x-1/2">
        {children}
      </div>
    </div>
  )
}
interface ToolbarItemContentsProps extends React.PropsWithChildren {
  itemConfig: ToolbarViewItem
  wrapperClassName?: string
  contentClassName?: string
}
/**
 * The single button and dropdown button share content, so we extract it here
 * It contains a tooltip with the title, description, and links.
 */
const ToolbarItemTooltip = memo(function ToolbarItemContents({
  itemConfig,
  wrapperClassName = '',
  contentClassName = '',
  children,
}: ToolbarItemContentsProps) {
  const onDesktop = isDesktop()
  const wrapperStyle = useMemo(
    () =>
      onDesktop
        ? // Without this, the tooltip disappears before being able to click on anything in it
          ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties)
        : {},
    [onDesktop]
  )

  return (
    <Tooltip
      inert={false}
      wrapperStyle={wrapperStyle}
      hoverOnly
      position="bottom"
      wrapperClassName={'!p-4 !pointer-events-auto ' + wrapperClassName}
      contentClassName={contentClassName}
    >
      {children}
    </Tooltip>
  )
})

const ToolbarItemTooltipShortContent = ({
  status,
  title,
  hotkey,
  platform,
}: {
  status: string
  title: string
  hotkey?: HotkeySequence
  platform: Platform
}) => {
  const hotkeyLabel = hotkeyDisplay(hotkey, platform)

  return (
    <div
      className={`text-sm flex flex-col ${
        !['available', 'experimental'].includes(status)
          ? 'text-chalkboard-70 dark:text-chalkboard-40'
          : ''
      }`}
    >
      {status === 'experimental' && (
        <div className="text-xs flex justify-center item-center gap-1 pb-1 border-b border-chalkboard-50">
          <CustomIcon name="beaker" className="w-4 h-4" />
          <span>Experimental</span>
        </div>
      )}
      <div
        className={`flex gap-4 ${status === 'experimental' ? 'pt-1' : 'p-0'}`}
      >
        {title}
        {hotkeyLabel && (
          <kbd className="inline-block ml-2 flex-none hotkey">
            {hotkeyLabel}
          </kbd>
        )}
      </div>
    </div>
  )
}

const ToolbarItemTooltipRichContent = memo(
  ({
    itemConfig,
    platform,
  }: {
    itemConfig: ToolbarViewItem
    platform: Platform
  }) => {
    const shouldBeEnabled = ['available', 'experimental'].includes(
      itemConfig.status
    )
    const hotkeyLabel = hotkeyDisplay(itemConfig.hotkey, platform)

    return (
      <>
        {itemConfig.status === 'experimental' && (
          <div className="text-xs flex items-center justify-center self-stretch gap-1 p-1 border-b">
            <CustomIcon name="beaker" className="w-4 h-4" />
            <span className="block">Experimental</span>
          </div>
        )}
        <div className="rounded-top flex items-center gap-2 pt-3 pb-2 px-2 bg-chalkboard-20/50 dark:bg-chalkboard-80/50">
          {itemConfig.icon && (
            <CustomIcon
              className="w-5 h-5"
              style={{
                color: itemConfig.disabled ? undefined : itemConfig.iconColor,
              }}
              name={itemConfig.icon}
            />
          )}
          <div
            className={`text-sm flex-1 flex flex-col gap-1 ${
              !shouldBeEnabled
                ? 'text-chalkboard-70 dark:text-chalkboard-40'
                : ''
            }`}
          >
            {itemConfig.tooltipTitle ?? itemConfig.title}
          </div>
          {shouldBeEnabled && hotkeyLabel ? (
            <kbd className="flex-none hotkey">{hotkeyLabel}</kbd>
          ) : itemConfig.status === 'kcl-only' ? (
            <>
              <span className="text-wrap font-sans flex-0 text-chalkboard-70 dark:text-chalkboard-40">
                KCL code only
              </span>
              <CustomIcon
                name="code"
                className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
              />
            </>
          ) : (
            itemConfig.status === 'unavailable' && (
              <>
                <span className="text-wrap font-sans flex-0 text-chalkboard-70 dark:text-chalkboard-40">
                  In development
                </span>
                <CustomIcon
                  name="lockClosed"
                  className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
                />
              </>
            )
          )}
        </div>
        <p className="px-2 my-2 text-ch font-sans">{itemConfig.description}</p>
        {itemConfig.extraInfo && (
          <p className="px-2 my-2 text-ch font-sans">
            <span className="font-semibold">Info: </span>
            {itemConfig.extraInfo}
          </p>
        )}
        {itemConfig.disabled && itemConfig.disabledReason && (
          <p className="mx-2 my-2 rounded border px-2 py-1.5 text-ch font-sans border-destroy-40 bg-destroy-10/50 text-destroy-80 dark:border-destroy-80 dark:bg-destroy-80/20 dark:text-destroy-20">
            {itemConfig.disabledReason}
          </p>
        )}
        {itemConfig.links.length > 0 && (
          <>
            <hr className="border-chalkboard-20 dark:border-chalkboard-80" />
            <ul className="p-0 px-1 m-0 flex flex-col">
              {itemConfig.links.map((link) => (
                <li key={link.label} className="contents">
                  <a
                    href={link.url}
                    onClick={openExternalBrowserIfDesktop(link.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center rounded-sm p-1 no-underline text-inherit hover:bg-primary/10 hover:text-primary dark:hover:bg-chalkboard-70 dark:hover:text-inherit"
                  >
                    <span className="flex-1">Open {link.label}</span>
                    <CustomIcon name="link" className="w-4 h-4" />
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    )
  },
  (oldP, newP) =>
    oldP.itemConfig === newP.itemConfig && oldP.platform === newP.platform
)
