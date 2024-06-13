import toast from 'react-hot-toast'

// Used to bubble errors up
export function err<T>(value: Exclude<T, Error> | Error): value is Error {
  if (!(value instanceof Error)) {
    return false
  }

  return true
}

// Used to report errors to user at a certain point in execution
export function trap<T>(
  value: Exclude<T, Error> | Error,
  opts: {
    altErr?: Error,
    suppress?: boolean
  }
): value is Error {
  if (!err(value)) {
    return false
  }

  console.error(value)
  opts?.suppress || toast.error((opts?.altErr ?? value ?? new Error('Unknown')).toString())
  return true
}
