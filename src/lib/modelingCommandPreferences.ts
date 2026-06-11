import {
  KCL_PRELUDE_BODY_TYPE_VALUES,
  type KclPreludeBodyType,
} from '@src/lib/constants'

const LAST_BODY_TYPE_STORAGE_KEY = 'modelingCommand:lastBodyType'

function isBodyType(value: unknown): value is KclPreludeBodyType {
  return (
    typeof value === 'string' &&
    KCL_PRELUDE_BODY_TYPE_VALUES.includes(value as KclPreludeBodyType)
  )
}

export function readLastBodyType(): KclPreludeBodyType | undefined {
  if (typeof localStorage === 'undefined') return undefined

  const value = localStorage.getItem(LAST_BODY_TYPE_STORAGE_KEY)
  return isBodyType(value) ? value : undefined
}

export function writeLastBodyType(value: unknown) {
  if (typeof localStorage === 'undefined' || !isBodyType(value)) return

  localStorage.setItem(LAST_BODY_TYPE_STORAGE_KEY, value)
}
