type AiPaneToggleButtonProps = {
  collapsed: boolean
  label: string
  onClick: () => void
  side: 'left' | 'right'
}

function SidebarToggleIcon({ side }: Pick<AiPaneToggleButtonProps, 'side'>) {
  const dividerX = side === 'left' ? 8 : 12

  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 20 20">
      <rect
        height="14"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
        width="14"
        x="3"
        y="3"
      />
      <path
        d={`M${dividerX} 3.75V16.25`}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function AiPaneToggleButton({
  collapsed,
  label,
  onClick,
  side,
}: AiPaneToggleButtonProps) {
  const action = collapsed ? 'Show' : 'Hide'

  return (
    <button
      aria-expanded={!collapsed}
      aria-label={`${action} ${label}`}
      className="m-0 grid h-7 w-7 flex-none place-content-center rounded-md border-none bg-transparent p-0 text-chalkboard-60 hover:bg-chalkboard-20 hover:text-chalkboard-100 dark:text-chalkboard-40 dark:hover:bg-chalkboard-90 dark:hover:text-chalkboard-10"
      onClick={onClick}
      title={`${action} ${label}`}
      type="button"
    >
      <SidebarToggleIcon side={side} />
    </button>
  )
}
