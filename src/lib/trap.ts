import toast from 'react-hot-toast'

type ExcludeErr<T> = Exclude<T, Error>

/**
 * Similar to Error, but more lightweight, without the stack trace.  It can also
 * be used to represent a reason for not being able to provide an alternative,
 * which isn't necessarily an error.
 */
export class Reason {
  message: string

  constructor(message: string) {
    this.message = message
  }

  toError() {
    return new Error(this.message)
  }
}

export function isNotErr<T>(
  value: ExcludeErr<T> | Error
): value is ExcludeErr<T> {
  return !(value instanceof Error)
}

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

export function report(
  message: string,
  { showToast }: { showToast: boolean } = { showToast: false }
) {
  console.error(message)
  if (showToast) {
    toast.error(message, { id: 'error' })
  }
}

/**
 * Report a promise rejection.  The type of reason is `any` so that it matches
 * Promise.prototype.catch.
 */
export function reportRejection(reason: any) {
  report((reason ?? 'Unknown promise rejection').toString())
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

export function reject(errOrString: Error | string): Promise<never> {
  return Promise.reject(errOrString)
}
