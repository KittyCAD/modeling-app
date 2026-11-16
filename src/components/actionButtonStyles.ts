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
