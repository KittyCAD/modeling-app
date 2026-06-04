// Package-level defaults only. App call sites should pass environment-aware
// URLs via withSiteBaseURL() when links need to follow dev/prod infra.
const SITE = 'https://zoo.dev'

export const paths = {
  ZOO_SITE: SITE,
  ZOO_ACCOUNT: `${SITE}/account`,
  ZOO_DESIGN_STUDIO_PAGE: `${SITE}/design-studio`,
  ZOO_UPGRADE: `${SITE}/design-studio-pricing`,
  ZOO_ML: `${SITE}/machine-learning-api`,
} as const
