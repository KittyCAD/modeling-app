import { PathValue, Paths } from './types'

export function setPropertyByPath<
  T extends { [key: string]: any },
  P extends Paths<T, 4>
>(obj: T, path: P, value: PathValue<T, P>) {
  if (typeof path === 'string') {
    const pList = path.split('.')
    const lastKey = pList.pop()
    const pointer = pList.reduce(
      (accumulator: { [x: string]: any }, currentValue: string | number) => {
        if (accumulator[currentValue] === undefined)
          accumulator[currentValue] = {}
        return accumulator[currentValue]
      },
      obj
    )
    if (typeof lastKey !== 'undefined') {
      pointer[lastKey] = value
      return obj
    }
  }
  return obj
}