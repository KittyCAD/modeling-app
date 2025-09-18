import { useEffect, useRef, useState, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import type { CommandArgument, KclCommandValue } from '@src/lib/commandTypes'
import { getCalculatedKclExpressionValue } from '@src/lib/kclHelpers'

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

  const xInputRef = useRef<HTMLInputElement>(null)
  const yInputRef = useRef<HTMLInputElement>(null)
  const zInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))

  // Focus the first input on mount
  useEffect(() => {
    if (xInputRef.current) {
      xInputRef.current.focus()
    }
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    // Validate that all values are not empty
    if (!x.trim() || !y.trim() || !z.trim()) {
      return // Don't submit if any value is empty
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
      formRef.current?.dispatchEvent(new Event('submit', { bubbles: true }))
    }
  }

  return (
    <div className="w-full">
      <form
        ref={formRef}
        id="vector3d-form"
        data-testid="vector3d-form"
        onSubmit={handleSubmit}
      >
        <div className="mx-4 mt-4 mb-2">
          <span className="capitalize text-chalkboard-80 dark:text-chalkboard-20 block mb-4">
            {arg.displayName || arg.name}
          </span>
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <label className="text-chalkboard-70 dark:text-chalkboard-40 w-4">
                X
              </label>
              <input
                ref={xInputRef}
                data-testid="vector3d-x-input"
                type="number"
                step="any"
                placeholder="X coordinate"
                value={x}
                onChange={(e) => setX(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, yInputRef)}
                className="flex-1 px-2 py-1 bg-transparent border-b border-b-chalkboard-50 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="text-chalkboard-70 dark:text-chalkboard-40 w-4">
                Y
              </label>
              <input
                ref={yInputRef}
                data-testid="vector3d-y-input"
                type="number"
                step="any"
                placeholder="Y coordinate"
                value={y}
                onChange={(e) => setY(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, zInputRef)}
                className="flex-1 px-2 py-1 bg-transparent border-b border-b-chalkboard-50 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="text-chalkboard-70 dark:text-chalkboard-40 w-4">
                Z
              </label>
              <input
                ref={zInputRef}
                data-testid="vector3d-z-input"
                type="number"
                step="any"
                placeholder="Z coordinate"
                value={z}
                onChange={(e) => setZ(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e)}
                className="flex-1 px-2 py-1 bg-transparent border-b border-b-chalkboard-50 focus:outline-none"
              />
            </div>
          </div>
        </div>
        <p className="mx-4 mb-4 text-sm text-chalkboard-70 dark:text-chalkboard-40">
          Enter X, Y, Z coordinates for the 3D vector
        </p>
      </form>
    </div>
  )
}

export default CommandBarVector3DInput
