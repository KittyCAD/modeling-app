import { useProjectSearch } from '@src/components/ProjectSearchBar'
import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, test } from 'vitest'

type Project = {
  id: string
  name?: string
  title?: string
  modified?: number
  syncStatus?: string
  libraryIds?: string[]
}

function renderProjectSearch(projects: Project[] | undefined) {
  return renderHook(
    ({ projects }: { projects: Project[] | undefined }) =>
      useProjectSearch(projects),
    { initialProps: { projects }, wrapper: StrictMode }
  )
}

describe('useProjectSearch compatibility', () => {
  test('returns current project objects after metadata-only updates', () => {
    const projects: Project[] = [
      {
        id: 'bracket',
        title: 'Bracket',
        name: 'bracket',
        modified: 1,
        syncStatus: 'pending',
        libraryIds: ['local'],
      },
      { id: 'gear', title: 'Gear' },
    ]
    const { result, rerender } = renderProjectSearch(projects)
    act(() => result.current.setQuery('bracket'))
    expect(result.current.searchResults).toEqual([projects[0]])

    const updated = projects.map((project) => ({
      ...project,
      modified: 2,
      syncStatus: 'synced',
      libraryIds: ['cloud'],
    }))
    rerender({ projects: updated })

    expect(result.current.searchResults).toEqual([updated[0]])
    expect(result.current.searchResults[0]).toBe(updated[0])
  })

  test('preserves match ranking when projects move to different positions', () => {
    const exact = { id: 'exact', title: 'Bracket', name: 'bracket' }
    const partial = {
      id: 'partial',
      title: 'Bracket side',
      name: 'bracket-side',
    }
    const { result, rerender } = renderProjectSearch([exact, partial])
    act(() => result.current.setQuery('bracket'))
    expect(result.current.searchResults).toEqual([exact, partial])

    rerender({ projects: [partial, exact] })
    expect(result.current.searchResults).toEqual([exact, partial])
    expect(result.current.searchResults[0]).toBe(exact)
  })

  test('keeps duplicate searchable fields tied to current identities and order', () => {
    const first = { id: 'first', name: 'bracket', title: 'Bracket' }
    const second = { id: 'second', name: 'bracket', title: 'Bracket' }
    const { result, rerender } = renderProjectSearch([first, second])
    act(() => result.current.setQuery('bracket'))
    expect(result.current.searchResults).toEqual([first, second])

    rerender({ projects: [second, first] })
    expect(result.current.searchResults).toEqual([second, first])
    expect(result.current.searchResults[0]).toBe(second)

    const replacement = { ...first, id: 'replacement' }
    rerender({ projects: [second, replacement] })
    expect(result.current.searchResults).toEqual([second, replacement])
    expect(result.current.searchResults[1]).toBe(replacement)
  })

  test('updates matching when names or titles change without changing list size', () => {
    const projects = [
      { id: 'first', name: 'bracket', title: 'Bracket' },
      { id: 'second', name: 'gear', title: 'Gear' },
    ]
    const { result, rerender } = renderProjectSearch(projects)
    act(() => result.current.setQuery('bracket'))
    expect(result.current.searchResults).toEqual([projects[0]])

    const renamed = [
      { ...projects[0], name: 'plate', title: 'Plate' },
      { ...projects[1], title: 'Bracket' },
    ]
    rerender({ projects: renamed })
    expect(result.current.searchResults).toEqual([renamed[1]])

    rerender({ projects: [renamed[0], { ...renamed[1], title: 'Gear' }] })
    expect(result.current.searchResults).toEqual([])
  })

  test('preserves title weighting, case-insensitive matching, and fuzzy results', () => {
    const nameMatch = { id: 'name', name: 'bracket', title: 'Plate' }
    const titleMatch = { id: 'title', name: 'plate', title: 'Bracket' }
    const unrelated = { id: 'unrelated', name: 'gear', title: 'Gear' }
    const { result } = renderProjectSearch([nameMatch, unrelated, titleMatch])

    act(() => result.current.setQuery('BRACKET'))
    expect(result.current.searchResults).toEqual([titleMatch, nameMatch])

    act(() => result.current.setQuery('brake'))
    expect(result.current.searchResults).toEqual([titleMatch, nameMatch])
  })

  test('handles loading, additions, removals, whitespace, and clearing the query', () => {
    const { result, rerender } = renderProjectSearch(undefined)
    act(() => result.current.setQuery('bracket'))
    expect(result.current.searchResults).toEqual([])

    const projects = [
      { id: 'gear', title: 'Gear' },
      { id: 'bracket', title: 'Bracket' },
      { id: 'unnamed' },
    ]
    rerender({ projects })
    expect(result.current.searchResults).toEqual([projects[1]])

    rerender({ projects: [projects[0]] })
    expect(result.current.searchResults).toEqual([])

    rerender({ projects })
    act(() => result.current.setQuery('   '))
    expect(result.current.searchResults).toEqual(projects)

    act(() => result.current.setQuery(''))
    expect(result.current.searchResults).toBe(projects)

    rerender({ projects: [] })
    expect(result.current.searchResults).toEqual([])
  })
})
