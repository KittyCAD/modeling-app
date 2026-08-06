export type DialogHeaderProps = {
  title: string
  onClose: () => void
  closeLabel?: string
}

function DragHandleIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <circle cx="6" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="14" cy="10" r="1.5" fill="currentColor" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" />
    </svg>
  )
}

export function DialogHeader({
  title,
  onClose,
  closeLabel = 'Cancel',
}: DialogHeaderProps) {
  return (
    <>
      <div className="flex min-h-8 cursor-move select-none items-center gap-1.5 border-chalkboard-30 border-b bg-chalkboard-10 px-2 py-1 pr-20 text-chalkboard-60 dark:border-chalkboard-80 dark:bg-chalkboard-100 dark:text-chalkboard-40">
        <DragHandleIcon />
        <span className="min-w-0 truncate text-xs font-medium text-chalkboard-90 dark:text-chalkboard-10">
          {title}
        </span>
      </div>
      <button
        data-testid="command-bar-close-button"
        onClick={onClose}
        onMouseDown={(event) => event.stopPropagation()}
        className="!absolute top-0.5 right-1 m-0 flex h-7 items-center gap-1 rounded-sm border-none bg-transparent px-2 py-1 text-xs text-chalkboard-80 hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:text-chalkboard-20 dark:hover:bg-chalkboard-90 dark:focus:bg-chalkboard-90"
        type="button"
        aria-label={closeLabel}
        title={`${closeLabel} esc`}
      >
        <CloseIcon />
        <span>{closeLabel}</span>
      </button>
    </>
  )
}
