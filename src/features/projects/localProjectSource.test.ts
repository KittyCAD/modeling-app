import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectFile } from '@src/contracts/projects'
import { createLocalProjectSource } from '@src/features/projects/localProjectSource'

const names = (source: ReturnType<typeof createLocalProjectSource>) =>
  source.projects.value.map((project) => project.name)

describe('local project source', () => {
  let source: ReturnType<typeof createLocalProjectSource>

  beforeEach(() => {
    source = createLocalProjectSource()
  })

  it('seeds projects on a first run so the app has something to open', () => {
    expect(names(source)).toContain('bracket-v2')
    expect(source.state.value).toBe('ready')
  })

  it('lists newest first, which is the order the home screen shows', () => {
    const modified = source.projects.value.map((project) => project.modifiedAt)
    expect(modified).toEqual([...modified].sort((a, b) => b - a))
  })

  it('qualifies ids with the source so two backends cannot collide', () => {
    for (const project of source.projects.value) {
      expect(project.id.startsWith('local:')).toBe(true)
      expect(project.sourceId).toBe('local')
    }
  })

  it('gives a new project one empty KCL file to land in', async () => {
    const created = await source.create('fixture')
    const files = await source.listFiles(created.id)

    expect(files.map((file) => file.path)).toEqual(['main.kcl'])
    expect(await source.readFile(created.id, 'main.kcl')).toBe('')
    expect(created.fileCount).toBe(1)
  })

  it('disambiguates a duplicate name instead of overwriting', async () => {
    const first = await source.create('fixture')
    const second = await source.create('fixture')

    expect(first.id).not.toBe(second.id)
    expect(second.name).toBe('fixture-2')
  })

  it('falls back to a placeholder name for an empty request', async () => {
    const created = await source.create('   ')
    expect(created.name).toBe('untitled')
  })

  it('keeps a rename from clobbering an existing project', async () => {
    await source.create('taken')
    const other = await source.create('other')

    await source.rename(other.id, 'taken')
    expect(names(source)).toContain('taken-2')
    expect(names(source)).toContain('taken')
  })

  it('bumps the revision and the timestamp on a write', async () => {
    const created = await source.create('fixture')
    const before = source.projects.value.find((p) => p.id === created.id)

    await source.writeFile(created.id, 'main.kcl', 'thickness = 4')
    const after = source.projects.value.find((p) => p.id === created.id)

    expect(await source.readFile(created.id, 'main.kcl')).toBe('thickness = 4')
    expect(after?.revision).toBe((before?.revision ?? 0) + 1)
    expect(after?.modifiedAt).toBeGreaterThanOrEqual(before?.modifiedAt ?? 0)
  })

  it('drops a deleted project from the list', async () => {
    const created = await source.create('fixture')
    await source.delete(created.id)
    expect(names(source)).not.toContain('fixture')
  })

  it('reports a missing project rather than returning nothing', async () => {
    await expect(source.listFiles('local:nope')).rejects.toThrow(/nope/)
    await expect(source.readFile('local:nope', 'main.kcl')).rejects.toThrow()
  })

  it('rejects an id belonging to another source', async () => {
    await expect(source.listFiles('cloud:bracket-v2')).rejects.toThrow()
  })

  it('reports a missing file inside a real project', async () => {
    const created = await source.create('fixture')
    await expect(source.readFile(created.id, 'nope.kcl')).rejects.toThrow(
      /nope\.kcl/
    )
  })

  it('persists across instances, which is what survives a reload', async () => {
    await source.create('persisted')
    expect(names(createLocalProjectSource())).toContain('persisted')
  })

  it('falls back to seeds when stored data is corrupt', () => {
    localStorage.setItem('zds.projects.local', '{not json')
    // Losing local scratch projects beats refusing to start.
    expect(names(createLocalProjectSource())).toContain('bracket-v2')
  })

  it('derives a directory tree from flat paths', async () => {
    const created = await source.create('nested')
    await source.writeFile(created.id, 'parts/lid.kcl', '')
    await source.writeFile(created.id, 'parts/body.kcl', '')
    await source.writeFile(created.id, 'README.md', '')

    const files = await source.listFiles(created.id)
    const parts = files.find((file) => file.name === 'parts')

    expect(parts?.kind).toBe('directory')
    // Directories first, then locale-alphabetical within each group — which is
    // case-insensitive, so main.kcl precedes README.md.
    expect(files.map((file) => file.name)).toEqual([
      'parts',
      'main.kcl',
      'README.md',
    ])
    expect(parts?.children?.map((child: ProjectFile) => child.path)).toEqual([
      'parts/body.kcl',
      'parts/lid.kcl',
    ])
  })
})
