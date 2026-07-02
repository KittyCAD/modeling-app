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

export function SubmitButton({
  disabled = false,
  isChecking = false,
  submitLabel = 'Submit',
  checkingLabel = 'Submitting...',
}: SubmitButtonProps) {
  const resolvedDisabled = disabled || isChecking
  const bgClassName = resolvedDisabled ? '!bg-3' : '!bg-primary'
  const iconClassName = resolvedDisabled ? '!text-3' : '!text-chalkboard-10'

  return (
    <button
      type="submit"
      tabIndex={0}
      className={`action-button group m-0 flex w-fit items-center gap-2 rounded-sm border border-solid border-chalkboard-30 p-0 text-xs leading-none text-chalkboard-100 hover:border-chalkboard-40 hover:brightness-110 hover:shadow focus:outline-current dark:border-chalkboard-70 dark:text-chalkboard-10 dark:hover:border-chalkboard-60 ${bgClassName}`}
      disabled={resolvedDisabled}
    >
      <span className={`pl-2 ${iconClassName}`}>
        {isChecking ? checkingLabel : submitLabel}
      </span>
      <span
        className={`inline-grid w-fit self-stretch place-content-center rounded-sm p-1 ${bgClassName} ${iconClassName}`}
      >
        <CheckIcon />
      </span>
    </button>
  )
}
