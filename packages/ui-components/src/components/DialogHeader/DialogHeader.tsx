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
      className="h-4 w-4"
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
      <div className="flex items-center gap-1.5 border-b border-chalkboard-20 px-3 py-1.5 pr-8 text-chalkboard-60 cursor-move select-none dark:border-chalkboard-70 dark:text-chalkboard-40">
        <DragHandleIcon />
        <span className="min-w-0 truncate text-xs uppercase tracking-wide">
          {title}
        </span>
      </div>
      <button
        data-testid="command-bar-close-button"
        onClick={onClose}
        onMouseDown={(event) => event.stopPropagation()}
        className="group m-0 border-none bg-transparent p-0 hover:bg-transparent !absolute right-2 top-2"
        type="button"
        aria-label={closeLabel}
        title={`${closeLabel} esc`}
      >
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-destroy-10 text-destroy-80 group-hover:brightness-110 dark:bg-destroy-80 dark:text-destroy-10">
          <CloseIcon />
        </span>
      </button>
    </>
  )
}
