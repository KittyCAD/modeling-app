import type { LogoLinkContribution } from '@zoo/zds-plugin'
import type { CommunityContributionAdapter } from '@src/lib/communityPlugins/contributions'
import { appHeaderStartItemsFacet } from '@src/registry/contracts/appHeader'
import { AppLogoHeaderItem } from '@src/registry/extensions/appLogo/AppLogoHeaderItem'
import { isErr } from '@src/lib/trap'
import { isRecord, isArray } from '@src/lib/utils'
import { contribute } from 'plankton'

/** Only bounded SVG path data crosses the guest boundary; no markup, URLs, or native event handlers. */
export function parseLogoLink(value: unknown): LogoLinkContribution | Error {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !['id', 'label', 'text', 'logo'].includes(key)
    ) ||
    typeof value.id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.id) ||
    typeof value.label !== 'string' ||
    !value.label.trim() ||
    value.label.length > 120 ||
    (value.text !== undefined &&
      (typeof value.text !== 'string' ||
        !value.text.trim() ||
        value.text.length > 80)) ||
    !isRecord(value.logo)
  )
    return new Error(
      'Logo links require a short id, accessible label, optional text, and SVG path data.'
    )
  const logo = value.logo
  if (
    Object.keys(logo).some((key) => !['viewBox', 'paths'].includes(key)) ||
    !isArray(logo.viewBox) ||
    logo.viewBox.length !== 4 ||
    !logo.viewBox.every(
      (value): value is number =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= 10_000
    ) ||
    logo.viewBox[2] <= 0 ||
    logo.viewBox[3] <= 0 ||
    !isArray(logo.paths) ||
    logo.paths.length < 1 ||
    logo.paths.length > 16 ||
    !logo.paths.every(
      (path): path is string =>
        typeof path === 'string' &&
        path.trim().length > 0 &&
        path.length <= 8000 &&
        /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/.test(path)
    )
  )
    return new Error(
      'Logo SVG requires a finite viewBox with positive size and 1-16 bounded path strings.'
    )
  return {
    id: value.id,
    label: value.label.trim(),
    ...(typeof value.text === 'string' ? { text: value.text.trim() } : {}),
    logo: {
      viewBox: [
        logo.viewBox[0],
        logo.viewBox[1],
        logo.viewBox[2],
        logo.viewBox[3],
      ],
      paths: [...logo.paths],
    },
  }
}

/** App Header owns the adapter; registering a logo conveys no project or network authority. */
export const logoLinkContributionAdapter: CommunityContributionAdapter = {
  kind: 'app.logoLink',
  requiredPermissions: [],
  prepare(value, { namespace }) {
    const definition = parseLogoLink(value)
    if (isErr(definition)) return definition
    return contribute(appHeaderStartItemsFacet, () => ({
      id: `${namespace}.${definition.id}`,
      order: -100,
      Component: ({ context }) => (
        <AppLogoHeaderItem context={context} label={definition.label}>
          <span className="flex max-w-64 items-center gap-2 text-default">
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox={definition.logo.viewBox.join(' ')}
              className="h-6 w-6 shrink-0"
              fill="currentColor"
            >
              {definition.logo.paths.map((path, index) => (
                <path key={index} d={path} />
              ))}
            </svg>
            {definition.text && (
              <span className="truncate text-sm font-semibold">
                {definition.text}
              </span>
            )}
          </span>
        </AppLogoHeaderItem>
      ),
    }))
  },
}
