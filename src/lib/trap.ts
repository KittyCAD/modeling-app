import toast from 'react-hot-toast'

type ExcludeErr<T> = Exclude<T, Error>

/**
 * This is intentionally *not* exported due to misuse.  We'd like to add a lint.
 */
function isErr<T>(value: ExcludeErr<T> | Error): value is Error {
  return value instanceof Error
}

// Used to bubble errors up
export function err<T>(value: ExcludeErr<T> | Error): value is Error {
  if (!isErr(value)) {
    return false
  }

  // TODO: Remove this once we have a lint to prevent misuse of this function.
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
    if (isErr(v)) {
      argsWErr.push(v)
    } else {
      argsWOutErr.push(v)
    }
  }
  return [argsWOutErr.length !== value.length, argsWOutErr, argsWErr]
}

/**
 * Report an error to the user.  Trapping is the opposite of propagating an
 * error.  We should propagate errors in low-level functions and trap at the top
 * level.
 */
export function trap<T>(
  value: ExcludeErr<T> | Error,
  opts?: {
    altErr?: Error
    suppress?: boolean
  }
): value is Error {
  if (!isErr(value)) {
    return false
  }

  console.error(value)
  opts?.suppress ||
    toast.error((opts?.altErr ?? value ?? new Error('Unknown')).toString(), {
      id: 'error',
    })
  return true
}

/**
 * Trap an error, suppressing it from the user.  Trapping is the opposite of
 * propagating an error.  We should propagate errors in low-level functions and
 * trap at the top level.
 */
export function trapSuppressed<T>(
  value: ExcludeErr<T> | Error
): value is Error {
  return trap(value, { suppress: true })
}
