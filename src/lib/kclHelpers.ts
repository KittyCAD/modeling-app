import { executeAstMock } from '@src/lang/langHelpers'
import {
  type SourceRange,
  type KclValue,
  formatNumberValue,
  parse,
  resultIsOk,
} from '@src/lang/wasm'
import type { KclExpression } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import type RustContext from '@src/lib/rustContext'
import { forceSuffix } from '@src/lang/util'
import { roundOff } from '@src/lib/utils'
import type { Expr } from '@rust/kcl-lib/bindings/FrontendApi'
import type { Vector2 } from 'three'

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
  rustContext: RustContext,
  options?: {
    allowArrays?: boolean
  }
) {
  // Create a one-line program that assigns the value to a variable
  const dummyProgramCode = `${DUMMY_VARIABLE_NAME} = ${value}`
  const wasmInstance = await rustContext.wasmInstancePromise
  const pResult = parse(dummyProgramCode, wasmInstance)
  if (err(pResult) || !resultIsOk(pResult)) return pResult
  const ast = pResult.program

  // Execute the program without hitting the engine
  const { execState } = await executeAstMock({
    ast,
    rustContext,
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
    options?.allowArrays &&
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
        const formatted = formatNumberValue(item.value, item.ty, wasmInstance)
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
    const formatted = formatNumberValue(
      varValue.value,
      varValue.ty,
      wasmInstance
    )
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

  console.log('resultRawValue', resultRawValue)
  console.log('valueAsString', valueAsString)

  return {
    astNode: variableDeclaratorAstNode,
    valueAsString,
  }
}

export async function stringToKclExpression(
  value: string,
  providedRustContext: RustContext,
  options?: {
    allowArrays?: boolean
  }
) {
  const calculatedResult = await getCalculatedKclExpressionValue(
    value,
    providedRustContext,
    options
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

/**
 * Helper function to apply a drag vector to a Point2D Expr.
 * Returns a new Expr with the vector applied.
 */
export function applyVectorToPoint2D(
  point: { x: Expr; y: Expr },
  vector: Vector2
): { x: Expr; y: Expr } {
  const xValue = extractNumericValue(point.x)
  const yValue = extractNumericValue(point.y)

  if (!xValue || !yValue) {
    // If we can't extract values, return original
    return point
  }

  return {
    x: {
      type: 'Var',
      value: roundOff(xValue.value + vector.x),
      units: forceSuffix(xValue.units),
    },
    y: {
      type: 'Var',
      value: roundOff(yValue.value + vector.y),
      units: forceSuffix(yValue.units),
    },
  }
}

/**
 * Helper function to extract numeric value from an Expr.
 * Returns the value and units, or null if the Expr doesn't contain a numeric value.
 */
function extractNumericValue(
  expr: Expr
): { value: number; units: string } | null {
  if (expr.type === 'Number' || expr.type === 'Var') {
    return {
      value: expr.value,
      units: expr.units,
    }
  }
  return null
}

/**
 * Checks if an Expr has a numeric value (is a Number or Var type).
 * Returns true if the Expr contains a numeric value, false otherwise.
 * This is a type predicate that narrows the type for TypeScript.
 */
export function hasNumericValue(
  expr: Expr
): expr is Extract<Expr, { type: 'Number' | 'Var' }> {
  return expr.type === 'Number' || expr.type === 'Var'
}

/**
 * Extracts the numeric value from an Expr (Number or Var type).
 * Returns the value if the Expr is a Number or Var, otherwise returns the default value (0).
 */
export function getNumericValue(expr: Expr, defaultValue = 0): number {
  if (expr.type === 'Number' || expr.type === 'Var') {
    return expr.value
  }
  return defaultValue
}
