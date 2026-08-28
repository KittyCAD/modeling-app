import { useSignal } from '@preact/signals'
import type { ComponentChildren, JSX, Ref } from 'preact'
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'preact/hooks'
import {
  type MenuItem,
  MenuPanel,
  type MenuSection,
  selectableMenuItems,
} from './menu'
import { type BaseProps, cx } from './shared'
import './contextMenu.css'

export interface ContextMenuOpenRequest {
  clientX: number
  clientY: number
  /** Focus returns here when the menu closes. */
  target: HTMLElement
}

export interface ContextMenuTargetProps {
  /** Attach to the element whose secondary click opens the menu. */
  onContextMenu: (event: MouseEvent) => void
  'aria-haspopup': 'menu'
}

export interface ContextMenuController {
  /** Open after a target-specific gesture recognizer accepts the request. */
  open: (request: ContextMenuOpenRequest) => void
}

export interface ContextMenuProps extends BaseProps {
  /**
   * The target is a render prop so no wrapper changes its layout or semantics.
   */
  target: (props: ContextMenuTargetProps) => ComponentChildren
  /**
   * Resolve at open time when the entries depend on what was clicked.
   * A static array is enough for targets whose context never changes.
   */
  sections: MenuSection[] | ((request: ContextMenuOpenRequest) => MenuSection[])
  label: string
  /** Manual opening for targets where a secondary-button drag means something. */
  controllerRef?: Ref<ContextMenuController>
}

interface Position {
  x: number
  y: number
}

const VIEWPORT_GUTTER = 4

/** Keep the panel inside the visible viewport while preserving the click edge. */
export function fitContextMenuPosition(
  requested: Position,
  menu: { width: number; height: number },
  viewport: { width: number; height: number }
): Position {
  return {
    x: Math.max(
      VIEWPORT_GUTTER,
      Math.min(requested.x, viewport.width - menu.width - VIEWPORT_GUTTER)
    ),
    y: Math.max(
      VIEWPORT_GUTTER,
      Math.min(requested.y, viewport.height - menu.height - VIEWPORT_GUTTER)
    ),
  }
}

/**
 * A menu opened at a pointer position.
 *
 * The full-viewport layer is deliberate: the first click outside dismisses the
 * menu instead of also activating whatever happened to sit underneath it. The
 * target itself is supplied as a render prop, so wrapping a video, tree row or
 * canvas never changes its DOM shape merely to gain a context menu.
 */
export function ContextMenu({
  target,
  sections,
  label,
  controllerRef = null,
  class: className,
  id,
  'data-testid': dataTestId,
}: ContextMenuProps) {
  const requested = useSignal<Position | null>(null)
  const fitted = useSignal<Position | null>(null)
  const openSections = useSignal<MenuSection[]>([])
  const highlighted = useSignal(-1)
  const panel = useRef<HTMLDivElement>(null)
  const targetElement = useRef<HTMLElement | null>(null)

  const close = () => {
    requested.value = null
    fitted.value = null
    highlighted.value = -1
    targetElement.current?.focus({ preventScroll: true })
  }

  const openContextMenu = (request: ContextMenuOpenRequest) => {
    const nextSections =
      typeof sections === 'function' ? sections(request) : sections
    const hasContent = nextSections.some(
      (section) =>
        (section.items?.length ?? 0) > 0 || section.content !== undefined
    )
    if (!hasContent) {
      return
    }

    targetElement.current = request.target
    openSections.value = nextSections
    requested.value = { x: request.clientX, y: request.clientY }
    fitted.value = null
    highlighted.value = -1
  }

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    // Nested targets own their own menu. Without this, a row inside a panel can
    // open both its menu and the panel's menu from one secondary click.
    event.stopPropagation()
    openContextMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      target: event.currentTarget as HTMLElement,
    })
  }

  useImperativeHandle(controllerRef, () => ({ open: openContextMenu }))

  useLayoutEffect(() => {
    if (!requested.value || fitted.value || !panel.current) {
      return
    }
    const bounds = panel.current.getBoundingClientRect()
    fitted.value = fitContextMenuPosition(
      requested.value,
      { width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight }
    )
    panel.current.focus({ preventScroll: true })
  })

  useEffect(() => {
    if (!requested.value) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const selectable = selectableMenuItems(openSections.value)
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          close()
          break
        case 'ArrowDown':
        case 'ArrowUp': {
          event.preventDefault()
          if (selectable.length === 0) {
            return
          }
          const delta = event.key === 'ArrowDown' ? 1 : -1
          highlighted.value =
            highlighted.value < 0
              ? delta > 0
                ? 0
                : selectable.length - 1
              : (highlighted.value + delta + selectable.length) %
                selectable.length
          break
        }
        case 'Enter':
        case ' ': {
          const item = selectable[highlighted.value]
          if (!item) {
            return
          }
          event.preventDefault()
          close()
          item.onSelect?.()
          break
        }
      }
    }

    const onResize = () => close()
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('resize', onResize)
    }
  })

  const targetProps: ContextMenuTargetProps = {
    onContextMenu,
    'aria-haspopup': 'menu',
  }
  const position = fitted.value ?? requested.value
  const style: JSX.CSSProperties | undefined = position
    ? { insetInlineStart: position.x, insetBlockStart: position.y }
    : undefined

  const select = (item: MenuItem) => {
    close()
    item.onSelect?.()
  }

  return (
    <>
      {target(targetProps)}
      {requested.value ? (
        <div class="zds-context-menu__layer" role="presentation">
          <button
            type="button"
            class="zds-context-menu__backdrop"
            tabIndex={-1}
            aria-label="Dismiss context menu"
            onPointerDown={(event) => {
              event.preventDefault()
              close()
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              requested.value = { x: event.clientX, y: event.clientY }
              fitted.value = null
            }}
          />
          <MenuPanel
            panelRef={panel}
            id={id}
            data-testid={dataTestId}
            class={cx('zds-context-menu__panel', className)}
            style={style}
            sections={openSections.value}
            label={label}
            highlighted={highlighted.value}
            onHighlight={(index) => {
              highlighted.value = index
            }}
            onSelect={select}
          />
        </div>
      ) : null}
    </>
  )
}
