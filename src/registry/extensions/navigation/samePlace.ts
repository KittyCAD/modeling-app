/**
 * Compare two `pathname + search` strings, ignoring a trailing slash on the
 * path.
 *
 * `/file/x/?cmd=y` and `/file/x?cmd=y` are the same route to React Router and
 * the same place to the app, and the difference is not something `AppLocation`
 * should learn to model. Without this the app would rewrite the URL purely to
 * delete a slash — a history entry that changes nothing — and the drift
 * detector would report it as a real disagreement.
 */
export function samePlace(a: string, b: string) {
  const normalise = (value: string) =>
    value.replace(/\/(\?|$)/, '$1').replace(/\/$/, '')
  return normalise(a) === normalise(b)
}
