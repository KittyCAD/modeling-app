import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'

export * from '@src/lib/atprotoSync/browserOAuthConnector'
export * from '@src/lib/atprotoSync/cloudSyncAdapter'
export * from '@src/lib/atprotoSync/desktopOAuth'
export * from '@src/lib/atprotoSync/oauth'

export const ATPROTO_PROJECT_LIBRARY_TYPE = 'atproto'
export const ATPROTO_PROJECT_LIBRARY_TITLE = 'ATProto Projects'
export const ATPROTO_PROJECT_LIBRARY_PATH_PREFIX = 'atproto://'

export function getDefaultAtprotoProjectLibrarySetting(
  identityHandle = 'franknoirot.co'
): ProjectLibrarySetting {
  return {
    title: ATPROTO_PROJECT_LIBRARY_TITLE,
    type: ATPROTO_PROJECT_LIBRARY_TYPE,
    path: `${ATPROTO_PROJECT_LIBRARY_PATH_PREFIX}${identityHandle}`,
    source: identityHandle,
  }
}
