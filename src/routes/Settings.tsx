import { faCheck, faFolder, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../components/ActionButton'
import { AppHeader } from '../components/AppHeader'
import { open } from '@tauri-apps/api/dialog'
import { useStore } from '../useStore'
import { useState } from 'react'
import { toast } from 'react-hot-toast'

export const Settings = () => {
  const { defaultDir: originalDir, setDefaultDir: saveDefaultDir } = useStore((s) => ({
    defaultDir: s.defaultDir,
    setDefaultDir: s.setDefaultDir,
  }))
  console.log('originalDir', originalDir.dir)
  const [defaultDir, setDefaultDir] = useState(originalDir)

  async function handleDirectorySelection() {
    const newDirectory = await open({
      directory: true,
      defaultPath: (defaultDir.base || '') + defaultDir.dir,
      title: 'Choose a new default directory',
    })

    if (newDirectory && newDirectory !== null && !Array.isArray(newDirectory)) {
      setDefaultDir({ base: defaultDir.base, dir: newDirectory})
    }

  }

  const handleSaveClick = () => {
    saveDefaultDir(defaultDir)
    toast.success('Settings saved!')
  }

  return (
    <>
      <AppHeader showToolbar={false}>
        <ActionButton as="link"  to="/" icon={{
            icon: faXmark,
            bgClassName: 'bg-destroy-80',
            iconClassName: 'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
        }} className='hover:border-destroy-40'>
          Close
        </ActionButton>
      </AppHeader>
      <div className="mt-24 max-w-5xl mx-auto">
        <h1 className="text-4xl font-bold">User Settings</h1>
        {(window as any).__TAURI__ && (
          <SettingsSection title="Default Directory"
            description="Where newly-created projects are saved on your local computer">
            <div className="w-full flex gap-4 p-1 rounded border border-chalkboard-30">
              <input className="flex-1 px-2 bg-transparent" value={defaultDir.dir} onChange={(e) => setDefaultDir({ base: originalDir.base, dir: e.target.value })} />
              <ActionButton as="button" className='bg-chalkboard-100 hover:bg-chalkboard-90 text-chalkboard-10 border-chalkboard-100 hover:border-chalkboard-70'
                onClick={handleDirectorySelection}
                icon={{ 
                  icon: faFolder,
                  bgClassName: 'bg-liquid-20 group-hover:bg-liquid-10 hover:bg-liquid-10',
                  iconClassName: 'text-liquid-90 group-hover:text-liquid-90 hover:text-liquid-90',
                }}>
                Choose a folder
              </ActionButton>
            </div>
          </SettingsSection>
        )}
        <ActionButton className="hover:border-succeed-50" onClick={handleSaveClick}
          icon={{
            icon: faCheck,
            bgClassName: 'bg-succeed-80 group-hover:bg-succeed-70 hover:bg-succeed-70',
            iconClassName: 'text-succeed-20 group-hover:text-succeed-10 hover:text-succeed-10',
          }}>
          Save Settings
        </ActionButton>
      </div>
    </>
  )
}

interface SettingsSectionProps extends React.PropsWithChildren {
  title: string
  description?: string
}

function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="my-8 flex gap-12 items-start">
      <div className='w-120'>
        <h2 className="text-2xl">{title}</h2>
        <p className="mt-2">{description}</p>
      </div>
      {children}
    </section>
  )
}