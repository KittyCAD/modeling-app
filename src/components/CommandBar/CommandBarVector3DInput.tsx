import { useEffect, useRef, useState, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import toast from 'react-hot-toast'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import type { CommandArgument, KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { CustomIcon } from '@src/components/CustomIcon'
import { Spinner } from '@src/components/Spinner'
import { roundOffWithUnits } from '@src/lib/utils'

// Type guard to safely check if a value is a KclCommandValue
function isKclCommandValue(value: unknown): value is KclCommandValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    'valueText' in value &&
    'valueAst' in value &&
    'valueCalculated' in value
  )
}

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
  const argumentValue = commandBarState.context.argumentsToSubmit[arg.name]
  const previouslySetValue = isKclCommandValue(argumentValue)
    ? argumentValue
    : undefined

  // Resolve current vector value, prioritizing previously set values over defaults
  const currentVectorString = useMemo(() => {
    // previously set value
    if (previouslySetValue?.valueText) {
      return previouslySetValue.valueText
    }
    // smart defaults
    if (arg.defaultValue) {
      return typeof arg.defaultValue === 'function'
        ? arg.defaultValue(commandBarState.context, undefined)
        : arg.defaultValue
    }
    // dumb defaults
    return '[0, 0, 0]'
  }, [previouslySetValue, commandBarState.context, arg])

  // Extract individual x, y, z values from the vector string
  const defaultValues = useMemo(() => {
    // Remove brackets and split by comma
    const cleaned = currentVectorString.replace(/^\[|\]$/g, '').trim()
    if (!cleaned) return { x: '0', y: '0', z: '0' }

    const parts = cleaned.split(',').map((part) => part.trim())
    return {
      x: parts[0] || '0',
      y: parts[1] || '0',
      z: parts[2] || '0',
    }
  }, [currentVectorString])

  // Separate states allow independent editing and better performance
  const [x, setX] = useState(defaultValues.x)
  const [y, setY] = useState(defaultValues.y)
  const [z, setZ] = useState(defaultValues.z)
  // Tracks form readiness based on calculation execution state
  const [canSubmit, setCanSubmit] = useState(true)

  // Get selection
  const {
    context: { selectionRanges },
  } = useModelingContext()

  // In the render, each input shows real-time feedback
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

  // DOM access for focus and keyboard navigation
  const xInputRef = useRef<HTMLInputElement>(null)
  const yInputRef = useRef<HTMLInputElement>(null)
  const zInputRef = useRef<HTMLInputElement>(null)

  // Close the command bar
  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))

  // Focus and select the first input on mount
  useEffect(() => {
    if (xInputRef.current) {
      xInputRef.current.focus()
      xInputRef.current.select()
    }
  }, [])

  // Form submission handler
  // Basic check (Are the calculations still running?)
  useEffect(() => {
    setCanSubmit(
      !xCalculation.isExecuting &&
        !yCalculation.isExecuting &&
        !zCalculation.isExecuting
    )
  }, [
    xCalculation.isExecuting,
    yCalculation.isExecuting,
    zCalculation.isExecuting,
  ])

  // Detailed validation (Is the user's input actually valid?)
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault() // stop the browser

    // 1. Check if calculations are still running
    if (!canSubmit) {
      toast.error('Please wait for calculations to complete')
      return
    }

    // 2. Validate that all coordinate values are not empty
    if (!x.trim() || !y.trim() || !z.trim()) {
      toast.error('Please enter values for all coordinates (X, Y, Z)')
      return
    }

    // 3. Check if all coordinates have valid calculated results
    if (
      xCalculation.calcResult === 'NAN' ||
      yCalculation.calcResult === 'NAN' ||
      zCalculation.calcResult === 'NAN'
    ) {
      toast.error('Invalid coordinate values - please check your input')
      return
    }

    // 4. Check if all coordinates have valid AST nodes for code generation
    if (
      !xCalculation.valueNode ||
      !yCalculation.valueNode ||
      !zCalculation.valueNode
    ) {
      toast.error('Unable to parse coordinate expressions')
      return
    }

    // 5. Create the vector expression for KCL parsing
    const vectorExpression = `[${x.trim()}, ${y.trim()}, ${z.trim()}]`

    // Calculate the KCL expression
    stringToKclExpression(vectorExpression, true)
      .then((result) => {
        if (result instanceof Error || 'errors' in result) {
          toast.error('Unable to create valid vector expression')
          console.error('Invalid vector expression:', vectorExpression)
          return
        }

        onSubmit(result)
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
      data-can-submit={canSubmit}
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
        Currently, you need to enter all XYZ values manually. Support for
        selecting references directly in the 3D scene is in development.
      </p>
    </form>
  )
}

export default CommandBarVector3DInput
