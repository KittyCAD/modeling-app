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
