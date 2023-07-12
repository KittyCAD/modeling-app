import { ActionIcon, ActionIconProps } from "./ActionIcon"

interface ActionButtonProps extends React.PropsWithChildren {
    icon?: ActionIconProps
    className?: string
    onClick?: () => void
}

export const ActionButton = (props: ActionButtonProps) => {
    return (
        <button onClick={props.onClick}
          className={`group mono flex items-center gap-2 text-chalkboard-110 rounded-sm border border-chalkboard-40 hover:border-liquid-40 p-[3px] p${props.icon ? 'r' : 'x'}-2 ${props.className}`}
        >
          {props.icon && <ActionIcon {...props.icon} />}
          {props.children}
        </button>
    )
}