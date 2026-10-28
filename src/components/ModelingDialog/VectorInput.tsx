import { useSignals } from '@preact/signals-react/runtime'
import { createRef, use, useEffect, useMemo, useRef, useState } from 'react'
import { CommandVectorCoordinateInput } from '@src/components/CommandBar/CommandVectorCoordinateInput'
import { fieldText } from '@src/components/ModelingDialog/arguments'
import { toUtf16 } from '@src/lang/errors'
import type { KclManager } from '@src/lang/KclManager'
import { parse, resultIsOk } from '@src/lang/wasm'
import type { CommandKclValidationState } from '@src/components/CommandBar/CommandKclInput'
import { isErr } from '@src/lib/trap'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

const scalarOptions = { allowArrays: false }
const emptySelection = { graphSelections: [], otherSelections: [] }

function initialCoordinates(
  value: unknown,
  dimensions: number,
  wasm: ModuleType
): string[] {
  const text = fieldText(value).trim()
  if (!text) return Array<string>(dimensions).fill('')
  const code = `vector = ${text}`
  const parsed = parse(code, wasm)
  const declaration =
    !isErr(parsed) && resultIsOk(parsed) ? parsed.program.body[0] : undefined
  const expression =
    declaration?.type === 'VariableDeclaration'
      ? declaration.declaration.init
      : undefined
  if (
    expression?.type === 'ArrayExpression' &&
    expression.elements.length === dimensions
  )
    return expression.elements.map(({ start, end }) =>
      code.slice(toUtf16(start, code), toUtf16(end, code))
    )
  return Array.from({ length: dimensions }, (_, index) => `(${text})[${index}]`)
}

export function VectorInput({
  id,
  label,
  inputType,
  value,
  required,
  autoFocus,
  kclManager,
  wasmPromise,
  onChange,
  onValidationChange,
}: {
  id: string
  label: string
  inputType: 'vector2d' | 'vector3d'
  value: unknown
  required: boolean
  autoFocus?: boolean
  kclManager: KclManager
  wasmPromise: Promise<ModuleType>
  onChange: (value: string) => void
  onValidationChange: (state: CommandKclValidationState) => void
}) {
  useSignals()
  const wasm = use(wasmPromise)
  const dimensions = inputType === 'vector2d' ? 2 : 3
  const [coordinates, setCoordinates] = useState(() =>
    initialCoordinates(value, dimensions, wasm)
  )
  const inputRefs = useMemo(
    () =>
      Array.from({ length: dimensions }, () => createRef<HTMLInputElement>()),
    [dimensions]
  )
  // Keep the hook calls fixed; 2D vectors leave the third coordinate blank.
  const calculations = [
    useCoordinateCalculation(coordinates[0], kclManager),
    useCoordinateCalculation(coordinates[1], kclManager),
    useCoordinateCalculation(coordinates[2], kclManager),
  ].slice(0, dimensions)
  const validationCallback = useRef(onValidationChange)
  validationCallback.current = onValidationChange
  const isEmpty = coordinates.every((coordinate) => !coordinate.trim())
  const canSubmit = isEmpty
    ? !required
    : coordinates.every(
        (coordinate, index) =>
          coordinate.trim() &&
          calculations[index].valueNode !== null &&
          calculations[index].calcResult !== 'NAN'
      )
  const isChecking = calculations.some((calculation) => calculation.isExecuting)
  useEffect(() => {
    validationCallback.current({ canSubmit, isChecking })
  }, [canSubmit, isChecking])

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      {coordinates.map((coordinate, index) => (
        <CommandVectorCoordinateInput
          key={index}
          id={index === 0 ? id : `${id}-${index}`}
          label={['X', 'Y', 'Z'][index]}
          testId={`${inputType}-${['x', 'y', 'z'][index]}-input`}
          value={coordinate}
          compact
          calculation={calculations[index]}
          inputRef={inputRefs[index]}
          autoFocus={autoFocus && index === 0}
          onChange={(text) => {
            const next = coordinates.map((current, currentIndex) =>
              currentIndex === index ? text : current
            )
            setCoordinates(next)
            onValidationChange({
              canSubmit: !required && next.every((current) => !current.trim()),
              isChecking: Boolean(text.trim()),
            })
            onChange(
              next.every((current) => !current.trim())
                ? ''
                : `[${next.map((current) => current.trim()).join(', ')}]`
            )
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && inputRefs[index + 1]?.current) {
              event.preventDefault()
              inputRefs[index + 1].current?.focus()
            }
          }}
        />
      ))}
    </div>
  )
}

function useCoordinateCalculation(
  value: string | undefined,
  kclManager: KclManager
) {
  return useCalculateKclExpression({
    value: value ?? '',
    selectionRanges: emptySelection,
    rustContext: kclManager.rustContext,
    code: kclManager.codeSignal.value,
    ast: kclManager.astSignal.value,
    variables: kclManager.variablesSignal.value,
    options: scalarOptions,
  })
}
