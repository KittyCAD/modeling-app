import { useEffect, useRef, useState, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import toast from 'react-hot-toast'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import type { CommandArgument, KclCommandValue } from '@src/lib/commandTypes'
import { getCalculatedKclExpressionValue } from '@src/lib/kclHelpers'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { useModelingContext } from '@src/hooks/useModelingContext'
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
  }, [previouslySetValue, commandBarState.context, arg])

  // Extract individual x, y, z values from the vector string
  const defaultValues = useMemo(
    () => parseVectorString(currentVectorString),
    [currentVectorString]
  )

  const [x, setX] = useState(defaultValues.x)
  const [y, setY] = useState(defaultValues.y)
  const [z, setZ] = useState(defaultValues.z)

  const {
    context: { selectionRanges },
  } = useModelingContext()

  // Use calculation hook for each coordinate
  const xCalculation = useCalculateKclExpression({
    value: x,
    selectionRanges,
    allowArrays: false,
  })

  const yCalculation = useCalculateKclExpression({
    value: y,
    selectionRanges,
    allowArrays: false,
  })

  const zCalculation = useCalculateKclExpression({
    value: z,
    selectionRanges,
    allowArrays: false,
  })

  const xInputRef = useRef<HTMLInputElement>(null)
  const yInputRef = useRef<HTMLInputElement>(null)
  const zInputRef = useRef<HTMLInputElement>(null)

  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))

  // Focus the first input on mount
  useEffect(() => {
    if (xInputRef.current) {
      xInputRef.current.focus()
      xInputRef.current.select()
    }
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    // Validate that all values are not empty and are valid
    if (!x.trim() || !y.trim() || !z.trim()) {
      toast.error('Please enter values for all coordinates (X, Y, Z)')
      return // Don't submit if any value is empty
    }

    // Check if all coordinates are valid
    if (
      xCalculation.calcResult === 'NAN' ||
      yCalculation.calcResult === 'NAN' ||
      zCalculation.calcResult === 'NAN'
    ) {
      toast.error('Invalid coordinate values - please check your input')
      return // Don't submit if any coordinate is invalid
    }

    // Check if all coordinates have valid AST nodes
    if (
      !xCalculation.valueNode ||
      !yCalculation.valueNode ||
      !zCalculation.valueNode
    ) {
      toast.error('Unable to parse coordinate expressions')
      return // Don't submit if any coordinate doesn't have a valid AST node
    }

    // Use KCL expression parsing to handle scientific notation properly
    const vectorExpression = `[${x.trim()}, ${y.trim()}, ${z.trim()}]`

    // Calculate the KCL expression asynchronously
    getCalculatedKclExpressionValue(vectorExpression, true)
      .then((result) => {
        if (result instanceof Error || 'errors' in result || !result.astNode) {
          toast.error('Unable to create valid vector expression')
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
        toast.error('Failed to calculate vector expression')
        console.error('Error calculating vector expression:', error)
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
      id="arg-form"
      className="mb-2"
      onSubmit={handleSubmit}
      data-can-submit={
        xCalculation.calcResult !== 'NAN' &&
        yCalculation.calcResult !== 'NAN' &&
        zCalculation.calcResult !== 'NAN' &&
        x.trim() &&
        y.trim() &&
        z.trim() &&
        !xCalculation.isExecuting &&
        !yCalculation.isExecuting &&
        !zCalculation.isExecuting
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
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => handleKeyDown(e, yInputRef)}
              className="flex-1 px-2 py-1 bg-transparent focus:outline-none"
            />
            <CustomIcon
              name="equal"
              className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span
              className={
                xCalculation.calcResult === 'NAN'
                  ? 'text-destroy-80 dark:text-destroy-40'
                  : 'text-succeed-80 dark:text-succeed-40'
              }
            >
              {xCalculation.isExecuting ? (
                <Spinner className="text-inherit w-4 h-4" />
              ) : xCalculation.calcResult === 'NAN' ? (
                "Can't calculate"
              ) : xCalculation.calcResult ? (
                roundOffWithUnits(xCalculation.calcResult, 4)
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
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => handleKeyDown(e, zInputRef)}
              className="flex-1 px-2 py-1 bg-transparent focus:outline-none"
            />
            <CustomIcon
              name="equal"
              className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span
              className={
                yCalculation.calcResult === 'NAN'
                  ? 'text-destroy-80 dark:text-destroy-40'
                  : 'text-succeed-80 dark:text-succeed-40'
              }
            >
              {yCalculation.isExecuting ? (
                <Spinner className="text-inherit w-4 h-4" />
              ) : yCalculation.calcResult === 'NAN' ? (
                "Can't calculate"
              ) : yCalculation.calcResult ? (
                roundOffWithUnits(yCalculation.calcResult, 4)
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
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => handleKeyDown(e)}
              className="flex-1 px-2 py-1 bg-transparent focus:outline-none"
            />
            <CustomIcon
              name="equal"
              className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span
              className={
                zCalculation.calcResult === 'NAN'
                  ? 'text-destroy-80 dark:text-destroy-40'
                  : 'text-succeed-80 dark:text-succeed-40'
              }
            >
              {zCalculation.isExecuting ? (
                <Spinner className="text-inherit w-4 h-4" />
              ) : zCalculation.calcResult === 'NAN' ? (
                "Can't calculate"
              ) : zCalculation.calcResult ? (
                roundOffWithUnits(zCalculation.calcResult, 4)
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
