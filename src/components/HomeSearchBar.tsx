import Fuse from 'fuse.js'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { CustomIcon } from '@src/components/CustomIcon'

import type { Project } from '@src/lib/project'
import type { Prompt } from '@src/machines/mlEphantManagerMachine'

export type HomeItem = Project | Prompt
export type HomeItems = Project[] | Prompt[]

export const areHomeItemsProjects = (items: HomeItems): items is Project[] => {
  const item = items[0]
  return item !== undefined && 'path' in item
}

export const areHomeItemsPrompts = (items: HomeItems): items is Prompt[] => {
  const item = items[0]
  return item !== undefined && typeof item.prompt === 'string'
}

export function useHomeSearch(initialSearchResults: HomeItems) {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] =
    useState<HomeItems>(initialSearchResults)

  useEffect(() => {
    setSearchResults(initialSearchResults)
  }, [initialSearchResults])

  const searchAgainst = (items: HomeItems) => (queryRequested: string) => {
    const nameKeyToMatchAgainst = areHomeItemsProjects(items)
      ? 'name'
      : 'prompt'

    const fuse = new Fuse(items, {
      keys: [{ name: nameKeyToMatchAgainst, weight: 0.7 }],
      includeScore: true,
    })

    const results = fuse.search(queryRequested).map((result) => result.item)

    // On an empty query, we consider that matching all items.
    setSearchResults(queryRequested.length > 0 ? results : items)
    setQuery(queryRequested)
  }

  return {
    searchAgainst,
    searchResults,
    query,
  }
}

export function HomeSearchBar({
  onChange,
}: {
  onChange: (query: string) => void
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
          onChange={(event) => onChange(event.target.value)}
          className="w-full text-sm bg-transparent focus:outline-none selection:bg-primary/20 dark:selection:bg-primary/40 dark:focus:outline-none"
          placeholder="Search (Ctrl+.)"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
        />
      </div>
    </div>
  )
}
