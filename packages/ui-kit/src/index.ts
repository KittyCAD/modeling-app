/**
 * @kittycad/ui-kit
 *
 * Design system and UI building blocks for Zoo Design Studio, built on Preact
 * plus signals. Components hold no colour or size values of their own: every
 * visual decision reads a design token, and each component exposes its own
 * custom properties, so a host app can adopt a component without adopting our
 * brand.
 *
 * Import `@kittycad/ui-kit/styles.css` once at the app entry to get tokens,
 * the reset, and the shared visual vocabulary.
 */

export {
  Button,
  type ButtonProps,
  type ButtonVariant,
} from './components/button'
export {
  ContextMenu,
  type ContextMenuController,
  type ContextMenuOpenRequest,
  type ContextMenuProps,
  type ContextMenuTargetProps,
  fitContextMenuPosition,
} from './components/contextMenu'
export {
  EmptyState,
  type EmptyStateProps,
} from './components/emptyState'
export { Icon, type IconProps } from './components/icon'
export {
  Menu,
  type MenuItem,
  type MenuProps,
  type MenuSection,
} from './components/menu'
export { Panel, type PanelProps } from './components/panel'
export {
  SheetCard,
  type SheetCardProps,
  type SheetField,
} from './components/sheetCard'
export {
  type BaseProps,
  type ControlSize,
  type MaybeSignal,
  cx,
  uniqueId,
} from './components/shared'
export {
  Select,
  type SelectOption,
  type SelectProps,
} from './components/select'
export {
  Split,
  type SplitOrientation,
  type SplitPane,
  type SplitProps,
} from './components/split'
export { Spinner, type SpinnerProps } from './components/spinner'
export {
  StatusDot,
  type StatusDotProps,
  type StatusTone,
} from './components/statusDot'
export { Switch, type SwitchProps } from './components/switch'
export { TextField, type TextFieldProps } from './components/textField'
export {
  type TooltipOptions,
  type TooltipPlacement,
  attachTooltip,
  useTooltip,
} from './components/tooltip'

export { type IconName, iconNames, iconPaths } from './icons'
export {
  type ThemeName,
  type TokenGroup,
  cssVar,
  resolveToken,
  themeAttribute,
  themeNames,
  tokens,
} from './tokens'
