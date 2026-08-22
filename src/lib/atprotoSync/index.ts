import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import { PROJECT_FOLDER } from '@src/lib/constants'

export * from '@src/lib/atprotoSync/browserOAuthConnector'
export * from '@src/lib/atprotoSync/cloudSyncAdapter'
export * from '@src/lib/atprotoSync/desktopOAuth'
export * from '@src/lib/atprotoSync/oauth'

export const ATPROTO_PROJECT_LIBRARY_TYPE = 'atproto'
export const ATPROTO_PROJECT_LIBRARY_TITLE = 'ATProto Projects'
export const ATPROTO_PROJECT_LIBRARY_PATH_PREFIX = 'atproto://'
export const ATPROTO_PROJECT_LIBRARY_LOCAL_PATH_PREFIX = `/documents/${PROJECT_FOLDER}/ATProto`

function atprotoProjectLibraryPathSegment(identityHandle: string) {
  return identityHandle.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'account'
}

export function getDefaultAtprotoProjectLibrarySetting(
  identityHandle = 'franknoirot.co',
  localMaterializationPath = `${ATPROTO_PROJECT_LIBRARY_LOCAL_PATH_PREFIX}/${atprotoProjectLibraryPathSegment(identityHandle)}`
): ProjectLibrarySetting {
  return {
    title: ATPROTO_PROJECT_LIBRARY_TITLE,
    type: ATPROTO_PROJECT_LIBRARY_TYPE,
    path: localMaterializationPath,
    source: identityHandle,
  }
}
