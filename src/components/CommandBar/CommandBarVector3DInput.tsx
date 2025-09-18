import { useEffect, useRef, useState, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import type { CommandArgument, KclCommandValue } from '@src/lib/commandTypes'
import { getCalculatedKclExpressionValue } from '@src/lib/kclHelpers'
import { CustomIcon } from '@src/components/CustomIcon'
import { Spinner } from '@src/components/Spinner'
import { roundOffWithUnits } from '@src/lib/utils'

function CommandBarVector3DInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'vector3d'
    name: string
  }
  stepBack: () => void
  onSubmit: (data: KclCommandValue) => void
}) {
  const commandBarState = useCommandBarState()
  const previouslySetValue = commandBarState.context.argumentsToSubmit[
    arg.name
  ] as KclCommandValue | undefined

  // Parse vector string format "[x, y, z]" into separate components
  const parseVectorString = (vectorStr: string) => {
    const match = vectorStr.match(/^\[([^,]+),\s*([^,]+),\s*([^\]]+)\]$/)
    return match
      ? {
          x: match[1].trim(),
          y: match[2].trim(),
          z: match[3].trim(),
        }
      : { x: '', y: '', z: '' }
  }

  // Resolve current vector value, prioritizing previously set values over defaults
  const currentVectorString = useMemo(() => {
    if (previouslySetValue?.valueText) {
      return previouslySetValue.valueText
    }

    if (arg.defaultValue) {
      return typeof arg.defaultValue === 'function'
        ? arg.defaultValue(commandBarState.context, undefined)
        : arg.defaultValue
    }

    return ''
  }, [arg.defaultValue, previouslySetValue, commandBarState.context])

  // Extract individual x, y, z values from the vector string
  const defaultValues = useMemo(
    () => parseVectorString(currentVectorString),
    [currentVectorString]
  )

  const [x, setX] = useState(defaultValues.x)
  const [y, setY] = useState(defaultValues.y)
  const [z, setZ] = useState(defaultValues.z)

  // Validation states for each coordinate
  const [xValidation, setXValidation] = useState<{
    isValid: boolean
    result: string | null
    isCalculating: boolean
  }>({ isValid: true, result: null, isCalculating: false })

  const [yValidation, setYValidation] = useState<{
    isValid: boolean
    result: string | null
    isCalculating: boolean
  }>({ isValid: true, result: null, isCalculating: false })

  const [zValidation, setZValidation] = useState<{
    isValid: boolean
    result: string | null
    isCalculating: boolean
  }>({ isValid: true, result: null, isCalculating: false })

  const xInputRef = useRef<HTMLInputElement>(null)
  const yInputRef = useRef<HTMLInputElement>(null)
  const zInputRef = useRef<HTMLInputElement>(null)

  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))

  // Validate individual coordinate value
  const validateCoordinate = async (
    value: string,
    setValidation: React.Dispatch<
      React.SetStateAction<{
        isValid: boolean
        result: string | null
        isCalculating: boolean
      }>
    >
  ) => {
    if (!value.trim()) {
      setValidation({ isValid: true, result: null, isCalculating: false })
      return
    }

    setValidation((prev) => ({ ...prev, isCalculating: true }))

    try {
      const result = await getCalculatedKclExpressionValue(value.trim(), true)

      if (result instanceof Error || 'errors' in result || !result.astNode) {
        setValidation({
          isValid: false,
          result: "Can't calculate",
          isCalculating: false,
        })
      } else {
        setValidation({
          isValid: true,
          result: result.valueAsString,
          isCalculating: false,
        })
      }
    } catch (error) {
      setValidation({
        isValid: false,
        result: "Can't calculate",
        isCalculating: false,
      })
    }
  }

  // Debounced validation effect for each coordinate
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      validateCoordinate(x, setXValidation)
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [x])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      validateCoordinate(y, setYValidation)
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [y])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      validateCoordinate(z, setZValidation)
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [z])

  // Focus the first input on mount
  useEffect(() => {
    if (xInputRef.current) {
      xInputRef.current.focus()
    }
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    // Validate that all values are not empty and are valid
    if (!x.trim() || !y.trim() || !z.trim()) {
      return // Don't submit if any value is empty
    }

    // Check if all coordinates are valid
    if (!xValidation.isValid || !yValidation.isValid || !zValidation.isValid) {
      return // Don't submit if any coordinate is invalid
    }

    // Use KCL expression parsing to handle scientific notation properly
    const vectorExpression = `[${x.trim()}, ${y.trim()}, ${z.trim()}]`

    // Calculate the KCL expression asynchronously
    getCalculatedKclExpressionValue(vectorExpression, true)
      .then((result) => {
        if (result instanceof Error || 'errors' in result || !result.astNode) {
          // Validation failed - could show an error message here
          console.error('Invalid vector expression:', vectorExpression)
          return
        }

        // Create KclCommandValue with the properly parsed AST
        const kclValue: KclCommandValue = {
          valueAst: result.astNode,
          valueText: vectorExpression,
          valueCalculated: result.valueAsString,
        }

        onSubmit(kclValue)
      })
      .catch((error) => {
        console.error('Error parsing vector expression:', error)
      })
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    nextInputRef?: React.RefObject<HTMLInputElement>
  ) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      commandBarActor.send({ type: 'Close' })
    }
    if (e.key === 'Backspace' && e.metaKey) {
      stepBack()
    }
    // Move to next input on Tab or Enter
    if ((e.key === 'Tab' || e.key === 'Enter') && nextInputRef?.current) {
      e.preventDefault()
      nextInputRef.current.focus()
    }
    // Submit form when Enter is pressed in the last field
    if (e.key === 'Enter' && !nextInputRef) {
      e.preventDefault()
      const form = e.currentTarget.form
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true }))
      }
    }
  }

  return (
    <form
      id="vector3d-form"
      className="mb-2"
      onSubmit={handleSubmit}
      data-can-submit={
        xValidation.isValid &&
        yValidation.isValid &&
        zValidation.isValid &&
        x.trim() &&
        y.trim() &&
        z.trim()
      }
    >
      <div className="mx-4 mt-4 mb-2">
        <span className="capitalize text-chalkboard-80 dark:text-chalkboard-20 block mb-4">
          {arg.displayName || arg.name}
        </span>
        <div className="space-y-2">
          <label className="flex gap-4 items-center border-solid border-b border-chalkboard-50">
            <span className="text-chalkboard-70 dark:text-chalkboard-40 w-4">
              X
            </span>
            <input
              ref={xInputRef}
              data-testid="vector3d-x-input"
              type="text"
              placeholder="X coordinate"
              value={x}
              onChange={(e) => setX(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, yInputRef)}
              className="flex-1 px-2 py-1 bg-transparent focus:outline-none"
            />
            <CustomIcon
              name="equal"
              className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span
              className={
                !xValidation.isValid
                  ? 'text-destroy-80 dark:text-destroy-40'
                  : 'text-succeed-80 dark:text-succeed-40'
              }
            >
              {xValidation.isCalculating ? (
                <Spinner className="text-inherit w-4 h-4" />
              ) : !xValidation.isValid ? (
                "Can't calculate"
              ) : xValidation.result ? (
                roundOffWithUnits(xValidation.result, 4)
              ) : (
                ''
              )}
            </span>
          </label>
          <label className="flex gap-4 items-center border-solid border-b border-chalkboard-50">
            <span className="text-chalkboard-70 dark:text-chalkboard-40 w-4">
              Y
            </span>
            <input
              ref={yInputRef}
              data-testid="vector3d-y-input"
              type="text"
              placeholder="Y coordinate"
              value={y}
              onChange={(e) => setY(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, zInputRef)}
              className="flex-1 px-2 py-1 bg-transparent focus:outline-none"
            />
            <CustomIcon
              name="equal"
              className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span
              className={
                !yValidation.isValid
                  ? 'text-destroy-80 dark:text-destroy-40'
                  : 'text-succeed-80 dark:text-succeed-40'
              }
            >
              {yValidation.isCalculating ? (
                <Spinner className="text-inherit w-4 h-4" />
              ) : !yValidation.isValid ? (
                "Can't calculate"
              ) : yValidation.result ? (
                roundOffWithUnits(yValidation.result, 4)
              ) : (
                ''
              )}
            </span>
          </label>
          <label className="flex gap-4 items-center border-solid border-b border-chalkboard-50">
            <span className="text-chalkboard-70 dark:text-chalkboard-40 w-4">
              Z
            </span>
            <input
              ref={zInputRef}
              data-testid="vector3d-z-input"
              type="text"
              placeholder="Z coordinate"
              value={z}
              onChange={(e) => setZ(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e)}
              className="flex-1 px-2 py-1 bg-transparent focus:outline-none"
            />
            <CustomIcon
              name="equal"
              className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span
              className={
                !zValidation.isValid
                  ? 'text-destroy-80 dark:text-destroy-40'
                  : 'text-succeed-80 dark:text-succeed-40'
              }
            >
              {zValidation.isCalculating ? (
                <Spinner className="text-inherit w-4 h-4" />
              ) : !zValidation.isValid ? (
                "Can't calculate"
              ) : zValidation.result ? (
                roundOffWithUnits(zValidation.result, 4)
              ) : (
                ''
              )}
            </span>
          </label>
        </div>
      </div>
      <p className="mx-4 mb-4 text-sm text-chalkboard-70 dark:text-chalkboard-40">
        Enter X, Y, Z coordinates for the 3D vector
      </p>
    </form>
  )
}

export default CommandBarVector3DInput
