export function getProjectHeaderButtonClasses(highlight = false) {
  return `relative inline-flex min-w-max items-center gap-1 border py-0 pl-0.5 pr-2 focus-visible:outline-appForeground active:border-primary ${
    highlight
      ? 'border-warn-80 bg-warn-10/60 text-warn-90 hover:bg-warn-20 dark:border-warn-40 dark:bg-warn-80/30 dark:text-warn-10 dark:hover:bg-warn-80/50'
      : 'border-chalkboard-30 bg-chalkboard-10/80 text-chalkboard-100 hover:border-chalkboard-40 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100/50 dark:text-chalkboard-10 dark:hover:border-chalkboard-60 dark:hover:bg-chalkboard-100'
  }`
}

export function getActionButtonClasses({
  hasIconStart = false,
  hasIconEnd = false,
  className = '',
}: {
  hasIconStart?: boolean
  hasIconEnd?: boolean
  className?: string
}) {
  return `action-button leading-[0.7] p-0 m-0 group text-xs leading-none flex items-center gap-2 rounded-sm border-solid border border-chalkboard-30 hover:border-chalkboard-40 enabled:dark:border-chalkboard-70 dark:hover:border-chalkboard-60 dark:bg-chalkboard-90/50 text-chalkboard-100 dark:text-chalkboard-10 ${
    hasIconStart ? (hasIconEnd ? 'px-0' : 'pr-2') : hasIconEnd ? 'pl-2' : 'px-2'
  } ${className}`
}
