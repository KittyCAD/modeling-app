import { useSignalEffect } from '@preact/signals-react'
import { CustomIcon } from '@src/components/CustomIcon'
import { noAutofillInputProps } from '@src/lib/autofill'
import { projectSearchFocusRequest } from '@src/lib/searchFocusRequests'
import Fuse from 'fuse.js'
import { useMemo, useRef, useState } from 'react'

type SearchableProject = {
  name?: string
  title?: string
}

export function useProjectSearch<T extends SearchableProject>(
  projects: T[] | undefined
) {
  const [query, setQuery] = useState('')
  const currentProjects = projects ?? []
  const searchableProjects = currentProjects.map(({ name, title }) => ({
    name,
    title,
  }))
  const searchKey = JSON.stringify(searchableProjects)
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchKey contains the ordered fields Fuse indexes, excluding metadata-only changes.
  const fuse = useMemo(
    () =>
      new Fuse(searchableProjects, {
        keys: [
          { name: 'title', weight: 0.8 },
          { name: 'name', weight: 0.2 },
        ],
        includeScore: true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchKey contains the ordered fields Fuse indexes.
    [searchKey]
  )
  const matchingIndices = useMemo(
    () =>
      query.length === 0
        ? []
        : fuse.search(query).map((result) => result.refIndex),
    [fuse, query]
  )
  // Matching depends on text; cards and sorting need the current metadata.
  const searchResults =
    query.length === 0
      ? currentProjects
      : matchingIndices.map((index) => currentProjects[index])

  return {
    searchResults,
    query,
    setQuery,
  }
}

export function ProjectSearchBar({
  setQuery,
  keybinding,
}: {
  setQuery: (query: string) => void
  keybinding?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const lastHandledFocusRequest = useRef(projectSearchFocusRequest.value)
  useSignalEffect(() => {
    const request = projectSearchFocusRequest.value
    if (request === lastHandledFocusRequest.current) {
      return
    }
    lastHandledFocusRequest.current = request
    inputRef.current?.focus()
  })

  return (
    <div className="relative group">
      <div className="flex items-center gap-2 py-0.5 pl-0.5 pr-2 rounded border-solid border border-primary/10 dark:border-chalkboard-80 focus-within:border-primary dark:focus-within:border-chalkboard-30">
        <CustomIcon
          name="search"
          className="w-5 h-5 rounded-sm bg-primary/10 dark:bg-transparent text-primary dark:text-chalkboard-10 group-focus-within:bg-primary group-focus-within:text-chalkboard-10"
        />
        <input
          {...noAutofillInputProps}
          ref={inputRef}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full text-sm bg-transparent focus:outline-none selection:bg-primary/20 dark:selection:bg-primary/40 dark:focus:outline-none"
          placeholder={
            keybinding ? `Search projects (${keybinding})` : 'Search projects'
          }
        />
      </div>
    </div>
  )
}
