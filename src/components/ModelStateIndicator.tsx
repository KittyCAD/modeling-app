import { Spinner } from './Spinner'
import { CustomIcon } from './CustomIcon'
import { useKclContext } from 'lang/KclProvider'

export const ModelStateIndicator = () => {
  const { isExecuting } = useKclContext()

  if (isExecuting)
    return (
      <div className="w-6 h-6" data-testid="model-state-indicator">
        <Spinner className="w-6 h-6" />
      </div>
    )

  return (
    <div
      className="border-6 border border-solid border-chalkboard-60 dark:border-chalkboard-80 bg-chalkboard-20 dark:bg-chalkboard-80 !group-disabled:bg-chalkboard-30 !dark:group-disabled:bg-chalkboard-80 rounded-sm bg-succeed-10/30 dark:bg-succeed"
      data-testid="model-state-indicator"
    >
      <CustomIcon
        data-testid="model-state-indicator-export-done"
        name="checkmark"
        className="w-6 h-6"
      />
    </div>
  )
}
