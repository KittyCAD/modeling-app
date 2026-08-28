import { Button, EmptyState, Icon } from '@kittycad/ui-kit'
import type { Signal } from '@preact/signals'
import { useService } from '@src/app/context'
import {
  type SettingsLevel,
  type SettingsSectionView,
  settingsService,
} from '@src/contracts/settings'
import { SettingRow } from '@src/features/settings/SettingRow'
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
}

/**
 * The settings dialog.
 *
 * Two panes: what there is to configure, and one group of it at a time. The
 * cascade shows up in one place — the level switch in the header — rather than
 * as a per-row scope picker, because the question "am I changing this for me or
 * for this project" is asked once per visit, not once per setting.
 */
export function SettingsDialog({ level }: SettingsDialogProps) {
  const settings = useService(settingsService)
  const sheetRef = useRef<HTMLDivElement>(null)

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
    .filter((section) => section.settings.length > 0)

  const active =
    sections.find((section) => section.id === openSection) ?? sections.at(0)

  // Switching levels can retire the open section. Following it keeps the URL
  // honest instead of leaving it pointing at a group that is no longer shown.
  useEffect(() => {
    if (!isOpen || !active || active.id === openSection) return
    settings.open(active.id)
  }, [isOpen, active, openSection, settings])

  useEffect(() => {
    if (!isOpen) return
    sheetRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
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
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                class="zds-settings__nav-item"
                aria-current={section.id === active?.id ? 'true' : undefined}
                onClick={() => settings.open(section.id)}
              >
                {section.icon ? (
                  <Icon name={section.icon} size="small" />
                ) : (
                  <span class="zds-settings__nav-bullet" aria-hidden="true" />
                )}
                <span>{section.title}</span>
              </button>
            ))}
          </nav>

          <div class="zds-settings__content zds-scroll">
            {active ? (
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
