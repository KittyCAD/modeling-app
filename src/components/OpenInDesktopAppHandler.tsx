// eslint-disable-next-line zds/no-react-router-hooks -- URL-state migration: preserve the handoff route, query, and hash when consuming ASK.
import { useLocation, useNavigate } from 'react-router-dom'

import { OpenInDesktopApp } from '@src/components/OpenInDesktopApp'
import { ASK_TO_OPEN_QUERY_PARAM } from '@src/lib/constants'
import { shouldShowDesktopHandoff } from '@src/lib/browserHandoff'
import { isDesktop } from '@src/lib/isDesktop'

/**
 * This component is a handler that checks if a certain query parameter
 * is present, and if so, it will show a modal asking the user if they
 * want to open the current page in the desktop app.
 */
export const OpenInDesktopAppHandler = (props: React.PropsWithChildren) => {
  const location = useLocation()
  const navigate = useNavigate()
  if (!shouldShowDesktopHandoff(location.search, isDesktop()))
    return props.children

  return (
    <OpenInDesktopApp
      onContinue={() => {
        const search = new URLSearchParams(location.search)
        search.delete(ASK_TO_OPEN_QUERY_PARAM)
        return navigate(
          {
            pathname: location.pathname,
            search: search.toString(),
            hash: location.hash,
          },
          { state: location.state }
        )
      }}
    />
  )
}
