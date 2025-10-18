import { executeAstMock } from '@src/lang/langHelpers'
import {
  type SourceRange,
  type KclValue,
  formatNumberValue,
  parse,
  resultIsOk,
  changeKclSettings,
} from '@src/lang/wasm'
import type { KclExpression } from '@src/lib/commandTypes'
import { codeManager, kclManager, rustContext } from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'

const DUMMY_VARIABLE_NAME = '__result__'

// Type guard for number value items
type KclNumber<T = KclValue> = T extends { type: 'Number' } ? T : never
function isNumberValueItem(item: KclValue): item is KclNumber {
  return item.type === 'Number'
}

/**
 * Calculate the value of the KCL expression,
 * given the value and the variables that are available in memory.
 * @param value - KCL expression to evaluate
 * @param allowArrays - Allow array values in result
 * @returns AST node and formatted value, or error
 */
export async function getCalculatedKclExpressionValue(
  value: string,
  allowArrays?: boolean
) {
  // Create a one-line program that assigns the value to a variable
  const dummyProgramCode = `${DUMMY_VARIABLE_NAME} = ${value}`
  const pResult = parse(dummyProgramCode)
  if (err(pResult) || !resultIsOk(pResult)) return pResult
  const ast = pResult.program

  // Execute the program without hitting the engine
  const { execState } = await executeAstMock({
    ast,
    rustContext: rustContext,
  })

  // Find the variable declaration for the result
  const resultDeclaration = ast.body.find(
    (a) =>
      a.type === 'VariableDeclaration' &&
      a.declaration.id?.name === DUMMY_VARIABLE_NAME
  )
  const variableDeclaratorAstNode =
    resultDeclaration?.type === 'VariableDeclaration' &&
    resultDeclaration?.declaration.init
  const varValue = execState.variables[DUMMY_VARIABLE_NAME]

  // Handle array values when allowArrays is true
  if (
    allowArrays &&
    varValue &&
    (varValue.type === 'Tuple' || varValue.type === 'HomArray')
  ) {
    // Reject empty arrays as they're not useful for geometric operations
    if (varValue.value.length === 0) {
      const valueAsString = 'NAN'
      return {
        astNode: variableDeclaratorAstNode,
        valueAsString,
      }
    }

    // Validate that all array elements are numbers
    const allElementsAreNumbers = varValue.value.every(isNumberValueItem)

    if (!allElementsAreNumbers) {
      const valueAsString = 'NAN'
      return {
        astNode: variableDeclaratorAstNode,
        valueAsString,
      }
    }

    const arrayValues = varValue.value.map((item: KclValue) => {
      if (isNumberValueItem(item)) {
        const formatted = formatNumberValue(item.value, item.ty)
        if (!err(formatted)) {
          return formatted
        }
        return String(item.value)
      }
      return String(item)
    })

    const valueAsString = `[${arrayValues.join(', ')}]`

    return {
      astNode: variableDeclaratorAstNode,
      valueAsString,
    }
  }

  // If the value is a number, attempt to format it with units.
  const resultValueWithUnits = (() => {
    if (!varValue || varValue.type !== 'Number') {
      return undefined
    }
    const formatted = formatNumberValue(varValue.value, varValue.ty)
    if (err(formatted)) return undefined
    return formatted
  })()
  // Prefer the formatted value with units.  Fallback to the raw value.
  const resultRawValue = varValue?.value
  const valueAsString = resultValueWithUnits
    ? resultValueWithUnits
    : typeof resultRawValue === 'number'
      ? String(resultRawValue)
      : 'NAN'

  return {
    astNode: variableDeclaratorAstNode,
    valueAsString,
  }
}

export async function stringToKclExpression(
  value: string,
  allowArrays?: boolean
) {
  const calculatedResult = await getCalculatedKclExpressionValue(
    value,
    allowArrays
  )
  if (err(calculatedResult) || 'errors' in calculatedResult) {
    return calculatedResult
  } else if (!calculatedResult.astNode) {
    return new Error('Failed to calculate KCL expression')
  }
  return {
    valueAst: calculatedResult.astNode,
    valueCalculated: calculatedResult.valueAsString,
    valueText: value,
  } satisfies KclExpression
}

export function getStringValue(code: string, range: SourceRange): string {
  return code.slice(range[0], range[1]).replaceAll(`'`, ``).replaceAll(`"`, ``)
}

export async function enableExperimentalFeatures(): Promise<void | Error> {
  const newCode = changeKclSettings(
    codeManager.code,
    kclManager.fileSettings.defaultLengthUnit ?? DEFAULT_DEFAULT_LENGTH_UNIT,
    'allow' // TODO: update that
  )
  if (err(newCode)) {
    return new Error(`Failed to set experimental features: ${newCode.message}`)
  }
  codeManager.updateCodeStateEditor(newCode)
  await codeManager.writeToFile()
  await kclManager.executeCode()
}
