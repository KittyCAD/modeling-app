import { type AiFirstCadMode, useAiFirstCad } from '@src/lib/aiFirstCad/context'

const modes: { label: string; value: AiFirstCadMode }[] = [
  { label: 'AI First CAD', value: 'ai' },
  { label: 'TradCAD', value: 'manual' },
  { label: 'CodeCAD', value: 'code' },
]

export function CadModeToggle() {
  const { mode, setMode } = useAiFirstCad()

  return (
    <fieldset
      aria-label="Modeling mode"
      className="flex h-7 shrink-0 items-center whitespace-nowrap rounded-full border border-chalkboard-30 bg-chalkboard-20 p-0.5 dark:border-chalkboard-70 dark:bg-chalkboard-100"
    >
      {modes.map((option) => {
        const isActive = mode === option.value
        return (
          <button
            aria-pressed={isActive}
            className={`h-6 min-w-14 flex-none whitespace-nowrap rounded-full px-3 text-xs font-semibold leading-none transition-colors ${
              isActive
                ? 'border-primary bg-primary text-white dark:border-primary dark:bg-primary'
                : 'border-transparent bg-transparent text-chalkboard-70 hover:text-chalkboard-100 dark:border-transparent dark:bg-transparent dark:text-chalkboard-30 dark:hover:text-chalkboard-10'
            }`}
            data-testid={`${option.value}-modeling-mode`}
            key={option.value}
            onClick={() => setMode(option.value)}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}
