import type { IconName } from '@kittycad/ui-kit'

export interface ContextMenuSectionPlacement {
  id: string
  /** Lower sections appear first. */
  order?: number
  label?: string
}

/**
 * One action contributed to a contextual surface.
 *
 * The context is supplied by the surface at the moment it opens. That is the
 * important distinction from an app-menu entry: a file action can inspect the
 * exact row under the pointer, and a scene action can inspect the click point
 * or services captured by its provider.
 */
export interface ContextMenuContribution<Context> {
  id: string
  /** Lower sorts earlier within its section. */
  order?: number
  section?: ContextMenuSectionPlacement
  /** Defaults to the command title when `commandId` is present. */
  label?: string
  /** Defaults to the command icon when `commandId` is present. */
  icon?: IconName
  shortcut?: string
  destructive?: boolean
  commandId?: string
  visible?: (context: Context) => boolean
  disabled?: boolean | ((context: Context) => boolean)
  /** Used only when this action does not name a command. */
  onSelect?: (context: Context) => void
}
