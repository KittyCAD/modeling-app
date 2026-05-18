import { RadioGroup } from '@headlessui/react'
import { useEffect, useState } from 'react'

import { SettingsTabButton } from '@src/components/Settings/SettingsTabButton'
import { userHasFeature } from '@src/lib/settings/settingsUtils'

const PLUGINS_FEATURE_FLAG = 'plugins'

interface SettingsTabButtonProps {
  value: string
  onChange: (value: string) => void
  showProjectTab: boolean
}

export function SettingsTabs({
  value,
  onChange,
  showProjectTab,
}: SettingsTabButtonProps) {
  const [showPluginsTab, setShowPluginsTab] = useState(false)

  useEffect(() => {
    let cancelled = false

    void userHasFeature(PLUGINS_FEATURE_FLAG, false).then((enabled) => {
      if (!cancelled) {
        setShowPluginsTab(enabled)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <RadioGroup
      value={value}
      onChange={onChange}
      className="flex justify-start pl-4 pr-5 gap-5 border-0 border-b border-b-chalkboard-20 dark:border-b-chalkboard-90"
    >
      <RadioGroup.Option value="user">
        {({ checked }) => (
          <SettingsTabButton checked={checked} icon="person" text="User" />
        )}
      </RadioGroup.Option>
      {showProjectTab && (
        <RadioGroup.Option value="project">
          {({ checked }) => (
            <SettingsTabButton
              checked={checked}
              icon="folder"
              text="This project"
            />
          )}
        </RadioGroup.Option>
      )}
      <RadioGroup.Option value="keybindings">
        {({ checked }) => (
          <SettingsTabButton
            checked={checked}
            icon="keyboard"
            text="Keybindings"
          />
        )}
      </RadioGroup.Option>
      {showPluginsTab && (
        <RadioGroup.Option value="plugins">
          {({ checked }) => (
            <SettingsTabButton
              checked={checked}
              icon="function"
              text="Plugins"
            />
          )}
        </RadioGroup.Option>
      )}
    </RadioGroup>
  )
}
