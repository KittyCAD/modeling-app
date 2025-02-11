/**
 * A safer type guard for arrays since the built-in Array.isArray() asserts `any[]`.
 */
export function isArray(val: any): val is unknown[] {
  // eslint-disable-next-line no-restricted-syntax
  return Array.isArray(val)
}
