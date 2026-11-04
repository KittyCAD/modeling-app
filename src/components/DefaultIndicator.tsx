export function DefaultIndicator({
  id,
  select = false,
}: {
  id: string
  select?: boolean
}) {
  return (
    <span
      id={id}
      className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[10px] text-chalkboard-70 dark:text-chalkboard-40 ${select ? 'right-6' : 'right-2'}`}
    >
      default
    </span>
  )
}
