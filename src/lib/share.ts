import toast from 'react-hot-toast'

import type { FileLinkParams } from '@src/lib/links'
import { createCreateFileUrl, createShortlink } from '@src/lib/links'
import { err } from '@src/lib/trap'

export type CopyCurrentFileShareLinkArgs = FileLinkParams & {
  token: string
}

/**
 * Temporary adapter around the legacy shortlink flow.
 * Swap this implementation to the project upload + share-links APIs once the
 * updated TS client exposes those endpoints.
 */
export async function copyCurrentFileShareLink(
  args: CopyCurrentFileShareLinkArgs
): Promise<boolean> {
  if (!args.token) {
    toast.error('You need to be signed in to share a file.', {
      duration: 5000,
    })
    return false
  }

  const shareUrl = createCreateFileUrl(args)
  const shortlink = await createShortlink(
    args.token,
    shareUrl.toString(),
    args.isRestrictedToOrg,
    args.password
  )

  if (err(shortlink)) {
    toast.error(shortlink.message, {
      duration: 5000,
    })
    return false
  }

  await globalThis.navigator.clipboard.writeText(shortlink.url)
  toast.success(
    'Link copied to clipboard. Anyone who clicks this link will get a copy of this file. Share carefully!',
    {
      duration: 5000,
    }
  )
  return true
}
