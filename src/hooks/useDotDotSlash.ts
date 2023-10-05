import { useLocation } from 'react-router-dom'

export function useDotDotSlash(): (count?: number) => string {
  const location = useLocation()
  const dotDotSlash = (count = 1): string => {
    // since we can't use relative paths (../) for windows
    if (location.pathname === '/') return ''
    const path = location.pathname.slice(0, location.pathname.lastIndexOf('/'))
    if (count <= 1) return path
    return dotDotSlash(count - 1)
  }
  return dotDotSlash
}
