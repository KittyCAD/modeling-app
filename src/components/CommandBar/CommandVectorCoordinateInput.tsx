import { CustomIcon } from '@src/components/CustomIcon'
import { Spinner } from '@src/components/Spinner'
import { noAutofillInputProps } from '@src/lib/autofill'
import type { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { roundOffWithUnits } from '@src/lib/utils'

export function CommandVectorCoordinateInput({
  label,
  value,
  onChange,
  calculation,
  inputRef,
  onKeyDown,
  testId,
  id,
  compact = false,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  calculation: ReturnType<typeof useCalculateKclExpression>
  inputRef: React.RefObject<HTMLInputElement | null>
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  testId: string
  id?: string
  compact?: boolean
  autoFocus?: boolean
}) {
  return (
    <label
      className={
        compact
          ? 'flex items-center gap-2 rounded-sm border border-chalkboard-30 px-2 dark:border-chalkboard-70'
          : 'flex gap-4 items-center border-solid border-b border-chalkboard-50'
      }
    >
      <span className="text-chalkboard-70 dark:text-chalkboard-40 w-4">
        {label}
      </span>
      <input
        {...noAutofillInputProps}
        ref={inputRef}
        id={id}
        aria-label={label}
        autoFocus={autoFocus}
        data-testid={testId}
        type="text"
        placeholder={`${label} coordinate`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={onKeyDown}
        className={
          compact
            ? 'min-w-0 flex-1 border-0 px-1 py-1 bg-transparent text-xs focus:outline-none'
            : 'flex-1 px-2 py-1 bg-transparent focus:outline-none'
        }
      />
      <CustomIcon
        name="equal"
        className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
      />
      <span
        className={
          calculation.calcResult === 'NAN'
            ? 'text-destroy-80 dark:text-destroy-40'
            : 'text-succeed-80 dark:text-succeed-40'
        }
      >
        {compact && !value.trim() ? (
          ''
        ) : calculation.isExecuting ? (
          <Spinner className="text-inherit w-4 h-4" />
        ) : calculation.calcResult === 'NAN' ? (
          "Can't calculate"
        ) : calculation.calcResult ? (
          roundOffWithUnits(calculation.calcResult, 4)
        ) : (
          ''
        )}
      </span>
    </label>
  )
}
