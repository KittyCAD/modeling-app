import fc from 'fast-check'
import { afterEach, beforeEach } from 'vitest'

/**
 * Reset browser storage between tests.
 *
 * Several services seed themselves from localStorage on construction — themes,
 * layouts, local projects — so leaking storage between tests makes them
 * order-dependent in ways that are miserable to debug.
 */
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-zds-theme')
})

/**
 * How many cases a property test runs.
 *
 * One number for the whole suite, because the point of a property test is the
 * number of inputs it tries and a file that quietly runs ten of them looks
 * exactly like a file that runs a thousand. 200 is enough to find the shapes
 * that matter — repeats, empty strings, chunk boundaries — while keeping the
 * unit suite in the hundreds of milliseconds.
 *
 * Raise it to hunt something: `FC_NUM_RUNS=20000 npm run test:properties`.
 *
 * On failure fast-check prints the shrunk counterexample and the seed that
 * found it. That seed is the reproduction: pass it back as
 * `fc.assert(property, { seed })` to replay the same run exactly.
 */
fc.configureGlobal({
  numRuns: Number(process.env.FC_NUM_RUNS ?? 200),
})
