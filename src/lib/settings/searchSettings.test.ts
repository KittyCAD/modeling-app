import { describe, expect, it } from 'vitest'
import type { AnySetting, SettingsSectionView } from '@src/contracts/settings'
import { countIn, searchSettings } from '@src/lib/settings/searchSettings'

const setting = (
  id: string,
  title: string,
  extra: Partial<AnySetting> = {}
): AnySetting =>
  ({
    id,
    section: id.split('.')[0],
    title,
    defaultValue: false,
    control: { kind: 'boolean' },
    toml: ['settings', ...id.split('.')],
    ...extra,
  }) as AnySetting

const sections: SettingsSectionView[] = [
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'How the app looks.',
    settings: [
      setting('appearance.theme', 'Colour theme', {
        description: 'Light or dark.',
        toml: ['settings', 'app', 'theme'],
      }),
      setting('appearance.density', 'Density'),
    ],
  },
  {
    id: 'modeling',
    title: 'Modeling',
    settings: [
      setting('modeling.projection', 'Projection', {
        description: 'How the scene is drawn.',
        toml: ['settings', 'modeling', 'camera_projection'],
        control: {
          kind: 'options',
          options: [
            { value: 'perspective', label: 'Perspective' },
            {
              value: 'orthographic',
              label: 'Orthographic',
              hint: 'No vanishing point',
            },
          ],
        },
      }),
    ],
  },
  {
    id: 'keybindings',
    title: 'Keybindings',
    description: 'Every shortcut.',
    settings: [],
    render: () => null,
  },
]

const found = (query: string) =>
  searchSettings(sections, query).flatMap((result) =>
    result.settings.map((each) => each.id)
  )

describe('searching the settings', () => {
  it('finds a setting by its name', () => {
    expect(found('density')).toEqual(['appearance.density'])
  })

  it('finds one by its description', () => {
    expect(found('light or dark')).toEqual(['appearance.theme'])
  })

  it('ignores case and punctuation', () => {
    expect(found('COLOUR-THEME')).toEqual(['appearance.theme'])
  })

  /*
   * The searchable text of one setting is several fields run together, so a
   * single substring would have to fall inside one of them.
   */
  it('matches terms that come from different fields', () => {
    expect(found('modeling projection')).toEqual(['modeling.projection'])
  })

  it('matches part of a word, so typing less still finds it', () => {
    expect(found('proj')).toEqual(['modeling.projection'])
  })

  /*
   * Fuzzy, which is the deal Fuse makes: a typo or half a word still finds the
   * row, and in exchange a query is a hint rather than a filter. Requiring every
   * term would trade that away, and the existing app's settings search is fuzzy
   * too.
   */
  it('forgives a typo', () => {
    expect(found('projecton')).toEqual(['modeling.projection'])
  })

  it('ranks the closest group first', () => {
    const results = searchSettings(sections, 'theme')

    expect(results[0].section.id).toBe('appearance')
  })

  /*
   * For a choice, the names are the setting: nobody looking for "Orthographic"
   * knows the row is called "Projection".
   */
  it('finds a setting by what it offers', () => {
    expect(found('orthographic')).toEqual(['modeling.projection'])
  })

  it('finds one by an option’s hint', () => {
    expect(found('vanishing point')).toEqual(['modeling.projection'])
  })

  /*
   * The dialog shows people the file its values are written to, on the grounds
   * that settings you cannot find are settings you cannot fix by hand. Somebody
   * who has read that file should be able to type what they saw in it.
   */
  it('finds one by the key it is written under', () => {
    expect(found('camera_projection')).toEqual(['modeling.projection'])
  })
})

describe('when a whole group matches', () => {
  /*
   * Being shown three of a group's five rows because the other two do not
   * repeat the group's name would read as the search being broken.
   */
  it('offers everything in it', () => {
    expect(found('appearance')).toEqual([
      'appearance.theme',
      'appearance.density',
    ])
  })

  it('says so, so a body-only group can show its body', () => {
    const results = searchSettings(sections, 'keybindings')

    expect(results).toHaveLength(1)
    expect(results[0].sectionMatched).toBe(true)
    expect(results[0].settings).toEqual([])
  })

  /*
   * A section that is a table rather than a list has nothing this search can
   * see, so it stays out of results it did not earn.
   */
  it('leaves a body-only group out when only its neighbours matched', () => {
    const results = searchSettings(sections, 'density')

    expect(results.map((result) => result.section.id)).toEqual(['appearance'])
  })
})

describe('what the results are for', () => {
  it('keeps the group, because a row’s name is only half its meaning', () => {
    const results = searchSettings(sections, 'theme')

    expect(results[0].section.title).toBe('Appearance')
  })

  it('counts what each group contributed', () => {
    const results = searchSettings(sections, 'appearance')

    expect(countIn(results, 'appearance')).toBe(2)
    expect(countIn(results, 'modeling')).toBe(0)
  })

  /* Whether a blank query means "everything" is the caller's question. */
  it('answers nothing at all for a blank query', () => {
    expect(searchSettings(sections, '')).toEqual([])
    expect(searchSettings(sections, '   ')).toEqual([])
  })

  it('answers nothing for a query that matches nothing', () => {
    expect(searchSettings(sections, 'kerning')).toEqual([])
  })
})
