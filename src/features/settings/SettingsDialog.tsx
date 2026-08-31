import { Button, EmptyState, Icon, TextField } from '@kittycad/ui-kit'
import {
  type Signal,
  useComputed,
  useSignal,
  useSignalEffect,
} from '@preact/signals'
import { useService } from '@src/app/context'
import {
  type SettingsLevel,
  type SettingsSectionView,
  settingsService,
} from '@src/contracts/settings'
import { SettingRow } from '@src/features/settings/SettingRow'
import type { SettingsSearchResult } from '@src/lib/settings/searchSettings'
import { countIn, searchSettings } from '@src/lib/settings/searchSettings'
import { useEffect, useRef } from 'preact/hooks'
import './settings.css'

interface SettingsDialogProps {
  /**
   * Which level is being edited.
   *
   * Deliberately not in the URL: a link to settings should open the settings
   * someone can act on, not resume a tab they were poking at. The section is
   * addressable; the level is not.
   */
  level: Signal<SettingsLevel>
  /**
   * Bumped to put the caret in the search field.
   *
   * A counter rather than a boolean, because the request is an *event* — asking
   * twice in a row has to focus twice, and a flag that is already true says
   * nothing the second time. Passed in rather than read from a service so the
   * dialog keeps taking its inputs as props, like the level above it.
   */
  focusSearch: Signal<number>
}

/**
 * The settings dialog.
 *
 * Two panes: what there is to configure, and one group of it at a time. The
 * cascade shows up in one place — the level switch in the header — rather than
 * as a per-row scope picker, because the question "am I changing this for me or
 * for this project" is asked once per visit, not once per setting.
 */
export function SettingsDialog({ level, focusSearch }: SettingsDialogProps) {
  const settings = useService(settingsService)
  const sheetRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const query = useSignal('')

  const openSection = settings.openSection.value
  const isOpen = openSection !== null
  const currentLevel = level.value
  const levelInfo =
    settings.levels.find((info) => info.level === currentLevel) ??
    settings.levels[0]
  const unavailableReason = levelInfo.unavailableReason.value
  const readOnly = unavailableReason !== null

  /**
   * Sections that have something to offer at this level.
   *
   * A section is dropped rather than shown empty: the colour theme has no
   * per-project meaning, so an "Appearance" group with nothing in it on the
   * project tab reads as a bug, not as a boundary.
   */
  const sections: SettingsSectionView[] = settings.sections.value
    .map((section) => ({
      ...section,
      settings: section.settings.filter((setting) =>
        settings.supportsLevel(setting, currentLevel)
      ),
    }))
    .filter(
      (section) =>
        section.settings.length > 0 ||
        // A section can also be a body with no rows — the keybindings table.
        // Which levels it belongs at is its own to say, since it has no
        // settings to answer for it.
        (section.render !== undefined &&
          (section.levels ?? ['user']).includes(currentLevel))
    )

  const active =
    sections.find((section) => section.id === openSection) ?? sections.at(0)

  /**
   * Searching, as a mode the whole body is in.
   *
   * With a query the two panes stop being "the list of groups" and "the open
   * group" and become "where it was found" and "everything that matched" — which
   * is why this is a boolean read in both, rather than a filter applied to one.
   */
  const searching = query.value.trim().length > 0
  const results = useComputed(() => searchSettings(sections, query.value)).value

  /** Go to a group by place rather than by name, which is the other way to look. */
  const choose = (sectionId: string) => {
    query.value = ''
    settings.open(sectionId)
  }

  // Switching levels can retire the open section. Following it keeps the URL
  // honest instead of leaving it pointing at a group that is no longer shown.
  useEffect(() => {
    if (!isOpen || !active || active.id === openSection) return
    settings.open(active.id)
  }, [isOpen, active, openSection, settings])

  /*
   * A fresh search each visit, and the sheet focused rather than the field.
   *
   * Remembering the last query would make the second visit slower than the
   * first, exactly as it would in the palette. Focus stays on the sheet because
   * the dialog is a place to read as often as a place to search, and taking the
   * caret would make every arrow key a text-editing key.
   */
  useEffect(() => {
    if (!isOpen) return
    query.value = ''
    sheetRef.current?.focus()
  }, [isOpen, query])

  /**
   * Take the caret when asked.
   *
   * The keystroke is the reason the field does not take focus on open: somebody
   * who wants to search says so, and everyone else gets a dialog whose arrow
   * keys still mean what they usually mean. Selecting the existing text makes
   * the shortcut work twice — the second press replaces the query rather than
   * appending to it.
   */
  useSignalEffect(() => {
    if (focusSearch.value === 0) return
    searchRef.current?.focus()
    searchRef.current?.select()
  })

  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()

      /*
       * A search in progress is what Escape means first. Closing the whole
       * dialog on the keystroke that everywhere else means "clear this field"
       * loses the place someone was in to a reflex.
       */
      if (query.value.length > 0) {
        query.value = ''
        return
      }

      settings.close()
    }

    // At the window, like the palette: a modal has to answer Escape wherever
    // focus is, including on a native select's dropdown.
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true })
  })

  const location = levelInfo.location.value ?? 'not stored'
  const lastSlash = location.lastIndexOf('/')
  const locationParts =
    lastSlash === -1
      ? { dir: '', file: location }
      : {
          dir: location.slice(0, lastSlash + 1),
          file: location.slice(lastSlash + 1),
        }

  if (!isOpen) return null

  return (
    <div class="zds-settings">
      <button
        type="button"
        class="zds-settings__scrim"
        aria-label="Close settings"
        onClick={() => settings.close()}
      />

      <div
        class="zds-settings__sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        ref={sheetRef}
      >
        <header class="zds-settings__header">
          <p class="zds-label zds-settings__eyebrow">Settings</p>

          <div
            class="zds-settings__levels"
            role="group"
            aria-label="Applies to"
          >
            {settings.levels.map((info) => (
              <button
                key={info.level}
                type="button"
                class="zds-settings__level"
                aria-pressed={info.level === currentLevel}
                title={info.unavailableReason.value ?? undefined}
                onClick={() => {
                  level.value = info.level
                }}
              >
                {info.label}
              </button>
            ))}
          </div>

          <Button
            variant="chassis"
            icon="close"
            label="Close settings"
            iconOnly
            onClick={() => settings.close()}
          />
        </header>

        <div class="zds-settings__body">
          <nav
            class="zds-settings__nav zds-scroll"
            aria-label="Settings groups"
          >
            {/* Above the groups, because it is another way of choosing one:
                by what a setting is called rather than by where it lives. */}
            <div class="zds-settings__search">
              <TextField
                label="Search settings"
                hideLabel
                icon="search"
                type="search"
                placeholder="Search settings"
                size="small"
                value={query}
                inputRef={searchRef}
                onValueInput={(value) => {
                  query.value = value
                }}
              />
            </div>

            {sections.map((section) => {
              const found = searching ? countIn(results, section.id) : 0

              return (
                <button
                  key={section.id}
                  type="button"
                  class="zds-settings__nav-item"
                  /* Nothing is *current* while searching: the pane is showing
                     every group at once, and marking one would be a lie. */
                  aria-current={
                    !searching && section.id === active?.id ? 'true' : undefined
                  }
                  /* Dimmed rather than removed. A group vanishing as you type
                     costs you the map of what there is to configure, which is
                     most of what the sidebar is for. */
                  data-quiet={searching && found === 0 ? 'true' : undefined}
                  onClick={() => choose(section.id)}
                >
                  {section.icon ? (
                    <Icon name={section.icon} size="small" />
                  ) : (
                    <span class="zds-settings__nav-bullet" aria-hidden="true" />
                  )}
                  <span>{section.title}</span>
                  {searching && found > 0 ? (
                    <span class="zds-settings__nav-count">{found}</span>
                  ) : null}
                </button>
              )
            })}
          </nav>

          <div class="zds-settings__content zds-scroll">
            {searching ? (
              <SearchResults
                results={results}
                level={currentLevel}
                query={query.value}
                readOnly={readOnly}
                onChoose={choose}
              />
            ) : active ? (
              <>
                <div class="zds-settings__content-header">
                  <h2 class="zds-settings__title">{active.title}</h2>
                  {active.description ? (
                    <p class="zds-settings__subtitle">{active.description}</p>
                  ) : null}
                </div>

                {unavailableReason ? (
                  <p class="zds-settings__notice" role="status">
                    {unavailableReason}
                  </p>
                ) : null}

                <div class="zds-settings__rows">
                  {active.settings.map((setting) => (
                    <SettingRow
                      key={setting.id}
                      setting={setting}
                      level={currentLevel}
                      disabled={readOnly}
                    />
                  ))}
                </div>

                {active.render?.({ level: currentLevel })}
              </>
            ) : (
              <EmptyState
                icon="gear"
                eyebrow={levelInfo.label}
                title="Nothing to set at this level"
                description={
                  unavailableReason ??
                  'No feature has contributed a setting that applies here yet.'
                }
              />
            )}
          </div>
        </div>

        <footer class="zds-settings__footer">
          {settings.error.value ? (
            <p class="zds-settings__error" role="alert">
              {settings.error.value}
            </p>
          ) : null}
          {/* The path, plainly. Settings that live in a file someone cannot
              find are settings they cannot back up, diff, or fix by hand.

              Split so the file name is never what gets truncated: the
              directory can lose its middle, but "user.toml" is the part that
              tells you what you are looking at. */}
          <p
            class="zds-value zds-settings__location"
            title={levelInfo.location.value ?? undefined}
          >
            <span class="zds-settings__location-dir">{locationParts.dir}</span>
            <span class="zds-settings__location-file">
              {locationParts.file}
            </span>
          </p>
        </footer>
      </div>
    </div>
  )
}

/**
 * Everything that matched, grouped by where it lives.
 *
 * Flat would be shorter and worse: "Projection" means nothing until you know it
 * is under Modeling, and the group heading is the only thing carrying that. The
 * heading is a button for the same reason — having found the setting, the next
 * thing somebody wants is often the rest of its group.
 */
function SearchResults({
  results,
  level,
  query,
  readOnly,
  onChoose,
}: {
  results: readonly SettingsSearchResult[]
  level: SettingsLevel
  query: string
  readOnly: boolean
  onChoose: (sectionId: string) => void
}) {
  if (results.length === 0) {
    return (
      <EmptyState
        icon="search"
        eyebrow="Search"
        title="Nothing matches"
        description={`No setting at this level answers to “${query}”. Settings are searched by name, description, the choices they offer, and the key they are written under.`}
      />
    )
  }

  return (
    <div class="zds-settings__results">
      {results.map((result) => (
        <section key={result.section.id} class="zds-settings__result">
          <button
            type="button"
            class="zds-settings__result-heading"
            onClick={() => onChoose(result.section.id)}
          >
            {result.section.icon ? (
              <Icon name={result.section.icon} size="small" />
            ) : null}
            <span>{result.section.title}</span>
            <Icon name="chevronRight" size="small" />
          </button>

          <div class="zds-settings__rows">
            {result.settings.map((setting) => (
              <SettingRow
                key={setting.id}
                setting={setting}
                level={level}
                disabled={readOnly}
              />
            ))}
          </div>

          {/* Only when the group's own name matched. A body is not a list of
              settings — the keybindings table is the case — so there is nothing
              in it this search can see, and producing it for a query that hit
              one of its neighbours' rows would be a guess. */}
          {result.sectionMatched ? result.section.render?.({ level }) : null}
        </section>
      ))}
    </div>
  )
}
