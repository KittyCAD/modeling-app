import type React from 'react'
import { useEffect, useMemo, useState } from 'react'

import CommandArgOptionInput from '@src/components/CommandBar/CommandArgOptionInput'
import CommandBarVector3DInput from '@src/components/CommandBar/CommandBarVector3DInput'
import { MarkdownText } from '@src/components/MarkdownText'
import type { KclManager } from '@src/lang/KclManager'
import { useApp } from '@src/lib/boot'
import type {
  Axis3DCommandValue,
  CommandArgument,
  CommandArgumentOption,
} from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'

type Axis3DMode = 'defaultAxis' | 'vector'
type Axis3DArgument = CommandArgument<Axis3DCommandValue> & {
  inputType: 'axis3d'
  name: string
}

const DEFAULT_AXIS_VECTOR_VALUES: Record<string, string> = {
  X: '[1, 0, 0]',
  Y: '[0, 1, 0]',
  Z: '[0, 0, 1]',
}

function getAxisText(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  return isKclCommandValue(value) ? value.valueText : undefined
}

function isDefaultAxisText(value: unknown) {
  const axisText = getAxisText(value)
  return axisText === 'X' || axisText === 'Y' || axisText === 'Z'
}

function getDefaultMode(value: unknown): Axis3DMode {
  return isKclCommandValue(value) && !isDefaultAxisText(value)
    ? 'vector'
    : 'defaultAxis'
}

function getVectorDefaultValue({
  currentValue,
  defaultValue,
  vectorDefaultValue,
}: {
  currentValue: unknown
  defaultValue: Axis3DArgument['defaultValue']
  vectorDefaultValue?: string
}) {
  if (isKclCommandValue(currentValue)) {
    return (
      DEFAULT_AXIS_VECTOR_VALUES[currentValue.valueText] ??
      currentValue.valueText
    )
  }

  const currentAxisText = getAxisText(currentValue)
  if (currentAxisText) {
    return DEFAULT_AXIS_VECTOR_VALUES[currentAxisText] ?? vectorDefaultValue
  }

  if (typeof defaultValue === 'string') {
    return DEFAULT_AXIS_VECTOR_VALUES[defaultValue] ?? vectorDefaultValue
  }

  return vectorDefaultValue ?? DEFAULT_AXIS_VECTOR_VALUES.Z
}

function optionsForCurrentDefaultAxis({
  currentValue,
  options,
}: {
  currentValue: unknown
  options: ReadonlyArray<CommandArgumentOption<Axis3DCommandValue>>
}) {
  const currentAxisText = getAxisText(currentValue)
  if (!isKclCommandValue(currentValue) || !isDefaultAxisText(currentAxisText)) {
    return options
  }

  return options.map((option) =>
    option.value === currentAxisText
      ? { ...option, value: currentValue }
      : option
  )
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`px-3 py-1 text-sm border border-solid first:rounded-l-sm last:rounded-r-sm ${
        active
          ? 'bg-primary text-chalkboard-10 border-primary'
          : 'bg-transparent text-chalkboard-80 dark:text-chalkboard-20 border-chalkboard-30 dark:border-chalkboard-70'
      }`}
    >
      {children}
    </button>
  )
}

function CommandBarAxis3DInput({
  arg,
  stepBack,
  onSubmit,
  executingEditor,
}: {
  arg: Axis3DArgument
  stepBack: () => void
  onSubmit: (data: Axis3DCommandValue) => void
  executingEditor: KclManager
}) {
  const { commands } = useApp()
  const commandBarState = commands.useState()
  const currentValue = commandBarState.context.argumentsToSubmit[arg.name]
  const defaultMode = getDefaultMode(currentValue)
  const [mode, setMode] = useState<Axis3DMode>(defaultMode)

  useEffect(() => {
    setMode(defaultMode)
  }, [arg.name, defaultMode])

  const vectorDefaultValue = useMemo(
    () =>
      getVectorDefaultValue({
        currentValue,
        defaultValue: arg.defaultValue,
        vectorDefaultValue: arg.vectorDefaultValue,
      }),
    [arg.defaultValue, arg.vectorDefaultValue, currentValue]
  )

  const options = useMemo(() => {
    if (typeof arg.options !== 'function') {
      return optionsForCurrentDefaultAxis({
        currentValue,
        options: arg.options,
      })
    }

    const optionsFromContext = arg.options
    return (
      commandBarContext: { argumentsToSubmit: Record<string, unknown> },
      machineContext?: unknown
    ) =>
      optionsForCurrentDefaultAxis({
        currentValue,
        options: optionsFromContext(commandBarContext, machineContext),
      })
  }, [arg, currentValue])

  const axisOptionArg = {
    ...arg,
    inputType: 'options',
    options,
    valueSummary: undefined,
  } as CommandArgument<unknown> & {
    inputType: 'options'
    name: string
  }

  const vectorArg = {
    ...arg,
    inputType: 'vector3d',
    defaultValue: vectorDefaultValue,
    valueSummary: undefined,
  } as CommandArgument<unknown> & {
    inputType: 'vector3d'
    name: string
  }

  return (
    <>
      <div className="mx-4 mt-4 mb-2 flex items-center gap-4">
        <span className="text-sm text-chalkboard-70 dark:text-chalkboard-40">
          Axis input
        </span>
        <div role="group" aria-label="Axis input mode" className="inline-flex">
          <ModeButton
            active={mode === 'defaultAxis'}
            onClick={() => setMode('defaultAxis')}
          >
            Default axis
          </ModeButton>
          <ModeButton
            active={mode === 'vector'}
            onClick={() => setMode('vector')}
          >
            Vector
          </ModeButton>
        </div>
      </div>
      {arg.description && (
        <MarkdownText
          text={arg.description}
          className="mx-4 mb-2 select-text text-sm leading-relaxed text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown [&_*]:select-text [&_strong]:font-semibold [&_strong]:text-chalkboard-90 dark:[&_strong]:text-chalkboard-20"
        />
      )}
      {mode === 'defaultAxis' ? (
        <CommandArgOptionInput
          arg={axisOptionArg}
          argName={arg.displayName || arg.name}
          stepBack={stepBack}
          onSubmit={(data) => onSubmit(data as Axis3DCommandValue)}
          placeholder="Select a default axis"
        />
      ) : (
        <CommandBarVector3DInput
          arg={vectorArg}
          stepBack={stepBack}
          onSubmit={(data) => onSubmit(data)}
          executingEditor={executingEditor}
        />
      )}
    </>
  )
}

export default CommandBarAxis3DInput
