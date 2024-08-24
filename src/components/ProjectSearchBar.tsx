import { Project } from 'lib/project'
import { CustomIcon } from './CustomIcon'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import Fuse from 'fuse.js'

export function useProjectSearch(projects: Project[]) {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState(projects)

  const fuse = new Fuse(projects, {
    keys: [{ name: 'name', weight: 0.7 }],
    includeScore: true,
  })

  useEffect(() => {
    const results = fuse.search(query).map((result) => result.item)
    setSearchResults(query.length > 0 ? results : projects)
  }, [query, projects])

  return {
    searchResults,
    query,
    setQuery,
  }
}

export function ProjectSearchBar({
  setQuery,
}: {
  setQuery: (query: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useHotkeys(
    'Ctrl+.',
    (event) => {
      event.preventDefault()
      inputRef.current?.focus()
    },
    { enableOnFormTags: true }
  )

  return (
    <div className="relative group">
      <div className="flex items-center gap-2 py-0.5 pl-0.5 pr-2 rounded border-solid border border-primary/10 dark:border-chalkboard-80 focus-within:border-primary dark:focus-within:border-chalkboard-30">
        <CustomIcon
          name="search"
          className="w-5 h-5 rounded-sm bg-primary/10 dark:bg-transparent text-primary dark:text-chalkboard-10 group-focus-within:bg-primary group-focus-within:text-chalkboard-10"
        />
        <input
          ref={inputRef}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full text-sm bg-transparent focus:outline-none selection:bg-primary/20 dark:selection:bg-primary/40 dark:focus:outline-none"
          placeholder="Search projects (^.)"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
        />
      </div>
    </div>
  )
}
