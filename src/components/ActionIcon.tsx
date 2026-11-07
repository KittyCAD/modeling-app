import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import type {
  ActionIconFrameProps,
  ActionIconSvgOptions,
} from '@src/components/ActionIconFrame'
import {
  ActionIconFrame,
  getActionIconSvgProps,
} from '@src/components/ActionIconFrame'

export interface ActionIconProps
  extends ActionIconFrameProps,
    ActionIconSvgOptions {
  icon?: CustomIconName
}

export const ActionIcon = (props: ActionIconProps) => {
  const {
    icon = 'exclamationMark',
    iconClassName,
    size = 'md',
    children,
    ...frameProps
  } = props

  return (
    <ActionIconFrame {...frameProps}>
      {children ? (
        children
      ) : (
        <CustomIcon
          name={icon}
          {...getActionIconSvgProps({ size, iconClassName })}
        />
      )}
    </ActionIconFrame>
  )
}
