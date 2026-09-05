export type SubmitButtonProps = {
  disabled?: boolean
  isChecking?: boolean
  submitLabel?: string
  checkingLabel?: string
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      width={20}
      height={20}
      className="h-auto text-inherit dark:text-current"
    >
      <path d="M5 10.5L8.5 14L15 6.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      width={20}
      height={20}
      className="h-auto animate-spin text-inherit dark:text-current"
    >
      <circle
        cx="10"
        cy="10"
        r="7"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <path
        d="M17 10A7 7 0 0010 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function SubmitButton({
  disabled = false,
  isChecking = false,
  submitLabel = 'Submit',
  checkingLabel = 'Submitting...',
}: SubmitButtonProps) {
  const resolvedDisabled = disabled || isChecking
  const bgClassName = resolvedDisabled
    ? 'bg-chalkboard-20/50 dark:bg-chalkboard-90'
    : '!bg-primary'
  const iconClassName = resolvedDisabled
    ? 'text-chalkboard-60 dark:text-chalkboard-40'
    : '!text-chalkboard-10'

  return (
    <button
      type="submit"
      tabIndex={0}
      className={`action-button group m-0 flex w-fit shrink-0 items-center gap-2 rounded-sm border border-solid border-chalkboard-30 p-0 text-xs leading-none text-chalkboard-100 enabled:hover:border-chalkboard-40 enabled:hover:brightness-110 enabled:hover:shadow focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-appForeground disabled:cursor-not-allowed disabled:border-chalkboard-20 dark:border-chalkboard-70 dark:text-chalkboard-10 dark:enabled:hover:border-chalkboard-60 dark:disabled:border-chalkboard-70 ${bgClassName}`}
      disabled={resolvedDisabled}
      aria-busy={isChecking}
    >
      <span className={`pl-2 ${iconClassName}`}>
        {isChecking ? checkingLabel : submitLabel}
      </span>
      <span
        className={`inline-grid w-fit self-stretch place-content-center rounded-sm p-1 ${bgClassName} ${iconClassName}`}
      >
        {isChecking ? <SpinnerIcon /> : <CheckIcon />}
      </span>
    </button>
  )
}
