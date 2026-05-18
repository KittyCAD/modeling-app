import { describe, expect, it } from 'vitest'
import type { ShouldRevalidateFunctionArgs } from 'react-router-dom'

import { shouldRevalidateFileRoute } from '@src/lib/routeRevalidation'

function fileRouteArgs(
  overrides: Partial<ShouldRevalidateFunctionArgs> = {}
): ShouldRevalidateFunctionArgs {
  return {
    currentParams: { id: '/projects/demo/main.kcl' },
    currentUrl: new URL('http://zds.test/file/%2Fprojects%2Fdemo%2Fmain.kcl'),
    defaultShouldRevalidate: true,
    nextParams: { id: '/projects/demo/main.kcl' },
    nextUrl: new URL('http://zds.test/file/%2Fprojects%2Fdemo%2Fmain.kcl'),
    ...overrides,
  }
}

describe('shouldRevalidateFileRoute', () => {
  it('skips revalidation when opening settings for the current file', () => {
    expect(
      shouldRevalidateFileRoute(
        fileRouteArgs({
          nextUrl: new URL(
            'http://zds.test/file/%2Fprojects%2Fdemo%2Fmain.kcl/settings?tab=project'
          ),
        })
      )
    ).toBe(false)
  })

  it('skips revalidation when closing a file modal child route', () => {
    expect(
      shouldRevalidateFileRoute(
        fileRouteArgs({
          currentUrl: new URL(
            'http://zds.test/file/%2Fprojects%2Fdemo%2Fmain.kcl/telemetry'
          ),
        })
      )
    ).toBe(false)
  })

  it('keeps the default behavior for explicit same-url revalidation', () => {
    expect(
      shouldRevalidateFileRoute(
        fileRouteArgs({
          currentUrl: new URL(
            'http://zds.test/file/%2Fprojects%2Fdemo%2Fmain.kcl/settings'
          ),
          defaultShouldRevalidate: true,
          nextUrl: new URL(
            'http://zds.test/file/%2Fprojects%2Fdemo%2Fmain.kcl/settings'
          ),
        })
      )
    ).toBe(true)
  })

  it('keeps the default behavior when the file route param changes', () => {
    expect(
      shouldRevalidateFileRoute(
        fileRouteArgs({
          nextParams: { id: '/projects/demo/other.kcl' },
          nextUrl: new URL(
            'http://zds.test/file/%2Fprojects%2Fdemo%2Fother.kcl/settings'
          ),
        })
      )
    ).toBe(true)
  })

  it('keeps the default behavior for form-triggered revalidation', () => {
    expect(
      shouldRevalidateFileRoute(
        fileRouteArgs({
          formMethod: 'POST',
          nextUrl: new URL(
            'http://zds.test/file/%2Fprojects%2Fdemo%2Fmain.kcl/settings'
          ),
        })
      )
    ).toBe(true)
  })
})
