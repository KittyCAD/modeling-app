import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'

export type NumberLiteralFormatter = {
  format_number_literal(
    value: number,
    suffix: string,
    decimals?: number
  ): string
}

/**
 * Format a number with suffix as KCL.
 */
export function formatNumberLiteral(
  value: number,
  suffix: NumericSuffix,
  wasmInstance: NumberLiteralFormatter,
  decimals?: number
): string | Error {
  try {
    return wasmInstance.format_number_literal(
      value,
      JSON.stringify(suffix),
      decimals
    )
  } catch (e) {
    return new Error(
      `Error formatting number literal: value=${value}, suffix=${suffix}`,
      { cause: e }
    )
  }
}
