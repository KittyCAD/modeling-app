import { CustomIcon } from '@src/components/CustomIcon'

export function ErrorBanner({
  title,
  message,
  messageTestId,
}: {
  title: string
  message: string
  messageTestId?: string
}) {
  const separatorIndex = message.indexOf(': ')
  const category = separatorIndex > 0 ? message.slice(0, separatorIndex) : ''
  const details =
    separatorIndex > 0 ? message.slice(separatorIndex + 2) : message

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-destroy-30 bg-destroy-10/40 px-3 py-2.5 dark:border-destroy-70 dark:bg-destroy-80/15"
    >
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-destroy-20/70 text-destroy-80 dark:bg-destroy-80/60 dark:text-destroy-20">
        <CustomIcon name="triangleExclamation" className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="font-medium text-xs text-destroy-80 dark:text-destroy-20">
          {title}
        </p>
        <p
          className="mt-0.5 select-text break-words text-xs leading-4 text-chalkboard-80 dark:text-chalkboard-20"
          data-testid={messageTestId}
        >
          {category && (
            <>
              <span className="mr-1 inline-flex rounded bg-destroy-20/60 px-1.5 py-0.5 text-[11px] font-medium leading-none capitalize text-destroy-80 dark:bg-destroy-80/50 dark:text-destroy-20">
                {category}:
              </span>{' '}
            </>
          )}
          {details}
        </p>
      </div>
    </div>
  )
}
