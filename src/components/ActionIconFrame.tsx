const iconSizes = {
  xs: 12,
  sm: 14,
  md: 20,
  lg: 24,
}

export interface ActionIconSvgOptions {
  iconClassName?: string
  size?: keyof typeof iconSizes
}

export function getActionIconSvgProps({
  size = 'md',
  iconClassName,
}: ActionIconSvgOptions = {}) {
  return {
    width: iconSizes[size],
    height: iconSizes[size],
    className: `h-auto text-inherit dark:text-current group-disabled:text-chalkboard-60 group-disabled:text-chalkboard-60 ${iconClassName}`,
  }
}

export interface ActionIconFrameProps extends React.PropsWithChildren {
  iconColor?: string
  className?: string
  bgClassName?: string
  'data-testid'?: string
}

/** Shared icon layout without loading the complete named-icon map. */
export function ActionIconFrame({
  children,
  iconColor,
  className,
  bgClassName,
  'data-testid': testId,
}: ActionIconFrameProps) {
  const computedBgClassName = `bg-chalkboard-20 dark:bg-chalkboard-80 group-disabled:bg-chalkboard-30 dark:group-disabled:bg-chalkboard-80 ${bgClassName}`

  return (
    <span style={{ display: 'contents', color: iconColor }}>
      <div
        data-testid={testId}
        className={
          `w-fit self-stretch inline-grid place-content-center ${className} ` +
          computedBgClassName
        }
      >
        {children}
      </div>
    </span>
  )
}
