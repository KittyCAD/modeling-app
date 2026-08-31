import Fuse from 'fuse.js'
import type {
  AnySetting,
  SettingsSection,
  SettingsSectionView,
} from '@src/contracts/settings'

/**
 * One section, and what in it matched.
 *
 * Grouped rather than flattened because a setting's title is only half its
 * meaning — "Projection" tells you nothing until you know it is under Modeling
 * and not under Appearance. Losing the group to show a flat list would make the
 * results harder to read than the dialog they came from.
 */
export interface SettingsSearchResult {
  section: SettingsSectionView
  settings: readonly AnySetting[]
  /**
   * The section itself matched, rather than only settings inside it.
   *
   * Which matters for a section that is a *body* rather than a list — the
   * keybindings table is one. Its contents are not settings and cannot be
   * searched from here, so the honest thing is to offer the whole table when its
   * own name matches, and say nothing about it otherwise.
   */
  sectionMatched: boolean
}

interface SearchableSetting {
  setting: AnySetting
  sectionId: string
  title: string
  sectionTitle: string
  description: string
  /** What a choice offers. For an option list, the names *are* the setting. */
  choices: string
  /** The TOML key, spaced out so `camera_projection` reads as two words. */
  key: string
  /** Everything at once, so a query can span two fields. */
  everything: string
}

const spaced = (text: string): string => text.replace(/[_.-]+/g, ' ')

const searchableFrom = (
  section: SettingsSectionView,
  setting: AnySetting
): SearchableSetting => {
  const choices =
    setting.control.kind === 'options'
      ? setting.control.options
          .flatMap((option: { label: string; hint?: string }) => [
            option.label,
            option.hint ?? '',
          ])
          .join(' ')
      : ''

  const key = spaced(setting.toml.join(' '))
  const description = setting.description ?? ''

  return {
    setting,
    sectionId: section.id,
    title: setting.title,
    sectionTitle: section.title,
    description,
    choices,
    key,
    everything: [setting.title, section.title, description, choices, key].join(
      ' '
    ),
  }
}

/**
 * How the fields are weighted against each other.
 *
 * A title match beats a section match beats anything in the body of the entry,
 * which is the order somebody scanning the dialog would rank them in themselves.
 *
 * Two of these are worth saying out loud. **The TOML key is searchable** because
 * the dialog already shows people the file its values are written to, on the
 * grounds that settings you cannot find are settings you cannot back up or fix by
 * hand — somebody who has read that file and wants to know what
 * `camera_projection` does should be able to type it. And **`everything` is a
 * concatenation of the rest**, weighted below all of them, because Fuse scores
 * each key separately: without it "modeling projection" matches neither the title
 * "Projection" nor the section "Modeling" well enough to survive, since neither
 * field contains both words. It is the cross-field fallback, and its low weight
 * keeps it from displacing a real title hit.
 */
const KEYS = [
  { name: 'title', weight: 3 },
  { name: 'sectionTitle', weight: 2 },
  { name: 'description', weight: 1 },
  { name: 'choices', weight: 1 },
  { name: 'key', weight: 1 },
  { name: 'everything', weight: 0.4 },
]

/**
 * Tight enough that a wrong guess returns nothing.
 *
 * Fuse's default of 0.6 is generous — in a list this small it will find
 * *something* for almost any string, and a settings search that always has an
 * answer teaches you not to trust it.
 *
 * `ignoreLocation` is the one that matters most and is the usual Fuse trap:
 * without it a match is scored by how near the start of the field it is, so a
 * word late in a description is missed even when it is exactly right.
 */
const OPTIONS = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.35,
  minMatchCharLength: 2,
}

/**
 * Find settings by name.
 *
 * Fuzzy, through Fuse, as the existing app's settings search is — so a typo or
 * half a word still finds the row. Returns nothing for a blank query; whether
 * that means "show everything" is the caller's question, since only the caller
 * knows whether anybody has typed.
 *
 * The index is built per call. At this size that is nothing — a few dozen
 * entries — and hoisting it would mean keeping it in step with a section list
 * that changes with the level, the platform and every contribution. Worth
 * revisiting if settings ever run to the hundreds.
 */
export function searchSettings(
  sections: readonly SettingsSectionView[],
  query: string
): readonly SettingsSearchResult[] {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const items = sections.flatMap((section) =>
    section.settings.map((setting) => searchableFrom(section, setting))
  )

  const hits = new Fuse(items, { ...OPTIONS, keys: KEYS }).search(trimmed)

  const sectionHits = new Fuse<SettingsSection>([...sections], {
    ...OPTIONS,
    keys: [
      { name: 'title', weight: 3 },
      { name: 'description', weight: 1 },
    ],
  }).search(trimmed)

  /** Best score per section, for ordering groups by relevance. */
  const scores = new Map<string, number>()
  const matched = new Set<string>()

  const note = (sectionId: string, score: number) => {
    const held = scores.get(sectionId)
    if (held === undefined || score < held) scores.set(sectionId, score)
  }

  for (const hit of hits) {
    matched.add(hit.item.setting.id)
    note(hit.item.sectionId, hit.score ?? 1)
  }

  const wholeSections = new Set(sectionHits.map((hit) => hit.item.id))
  for (const hit of sectionHits) note(hit.item.id, hit.score ?? 1)

  const results: SettingsSearchResult[] = []

  for (const section of sections) {
    const sectionMatched = wholeSections.has(section.id)

    /*
     * A section whose own name matched offers everything in it. Typing
     * "appearance" and being shown three of its five rows, because the other two
     * do not repeat the word, would read as the search being broken.
     */
    const settings = sectionMatched
      ? section.settings
      : section.settings.filter((setting) => matched.has(setting.id))

    if (settings.length === 0 && !sectionMatched) continue
    results.push({ section, settings, sectionMatched })
  }

  /*
   * Best group first. Within a group the settings keep the dialog's own order
   * rather than the search's — a group is a list somebody may already know the
   * shape of, and reordering it under them costs more than ranking gains.
   */
  return results.sort(
    (left, right) =>
      (scores.get(left.section.id) ?? 1) - (scores.get(right.section.id) ?? 1)
  )
}

/** How many rows a section would contribute, for the count beside its name. */
export function countIn(
  results: readonly SettingsSearchResult[],
  sectionId: string
): number {
  return (
    results.find((result) => result.section.id === sectionId)?.settings
      .length ?? 0
  )
}
