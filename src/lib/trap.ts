import toast from 'react-hot-toast'

type ExcludeErr<T> = Exclude<T, Error>

// Used to bubble errors up
export function err<T>(value: ExcludeErr<T> | Error): value is Error {
  if (!(value instanceof Error)) {
    return false
  }

  console.error(value)
  return true
}

/** Takes array of maybe error and types narrows them into
 * @returns [hasErr, arrayWithoutErr, arrayWithErr]
 */
export function cleanErrs<T>(
  value: Array<ExcludeErr<T> | Error>
): [boolean, Array<ExcludeErr<T>>, Array<Error>] {
  const argsWOutErr: Array<ExcludeErr<T>> = []
  const argsWErr: Array<Error> = []
  for (const v of value) {
    if (err(v)) {
      argsWErr.push(v)
    } else {
      argsWOutErr.push(v)
    }
  }
  return [argsWOutErr.length !== value.length, argsWOutErr, argsWErr]
}

/**
 *  Used to report errors to user at a certain point in execution
 *  @returns boolean
 */
export function trap<T>(
  value: ExcludeErr<T> | Error,
  opts?: {
    altErr?: Error
    suppress?: boolean
  }
): value is Error {
  if (!err(value)) {
    return false
  }

  console.error(value)
  opts?.suppress ||
    toast.error((opts?.altErr ?? value ?? new Error('Unknown')).toString(), {
      id: 'error',
    })
  return true
}
