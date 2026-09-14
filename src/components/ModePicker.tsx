import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import { modesService } from '@src/registry/contracts/modes'

export function ModePicker({ disabled = false }: { disabled?: boolean }) {
  useSignals()
  const { registry } = useApp()
  const modes = registry.get(modesService)
  const activeMode = modes.activeMode.value
  const selectableModes = modes.modes.value.filter(
    (mode) => mode.selectable !== false
  )

  if (selectableModes.length < 2 || !activeMode) return null

  return (
    <li className="flex items-center border-r border-chalkboard-30 dark:border-chalkboard-80 pr-2 mr-1">
      <select
        aria-label="Mode"
        className="text-xs bg-transparent rounded-sm border-0 py-1 pr-5 cursor-pointer disabled:cursor-default disabled:opacity-50"
        value={activeMode.id}
        disabled={disabled || !modes.canSelectMode.value}
        onChange={(event) => modes.setMode(event.target.value)}
      >
        {activeMode.selectable === false && (
          <option value={activeMode.id}>{activeMode.label}</option>
        )}
        {selectableModes.map((mode) => (
          <option key={mode.id} value={mode.id}>
            {mode.label}
          </option>
        ))}
      </select>
    </li>
  )
}
