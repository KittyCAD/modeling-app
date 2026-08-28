import { Button, TextField } from '@kittycad/ui-kit'
import { useComputed } from '@preact/signals'
import { useService } from '@src/app/context'
import { authService } from '@src/contracts/auth'
import { cloudSyncService } from '@src/contracts/cloudSync'
import type { ProjectLibrarySettingsDetailsProps } from '@src/contracts/projectLibraries'

/** Account and materialization details owned by the Cloud library provider. */
export function CloudLibrarySettingsDetails({
  library,
  readOnly,
}: ProjectLibrarySettingsDetailsProps) {
  const auth = useService(authService)
  const sync = useService(cloudSyncService)
  const status = useComputed(() => sync.status.value)
  const signedIn = auth.status.value === 'signedIn'

  const statusText = !signedIn
    ? 'Sign in to connect this library to your Zoo account.'
    : status.value.state === 'syncing' &&
        status.value.activeLibraryId === library.id
      ? 'Synchronizing local and cloud projects…'
      : status.value.state === 'conflict'
        ? `${status.value.conflictCount} project conflict${status.value.conflictCount === 1 ? '' : 's'} need attention.`
        : status.value.state === 'error'
          ? status.value.error || 'Cloud sync failed.'
          : status.value.lastSyncedAt
            ? `Last synchronized ${new Date(status.value.lastSyncedAt).toLocaleString()}.`
            : 'Ready to synchronize.'

  return (
    <div class="zds-cloud-library-settings">
      <TextField
        label="Cloud source"
        value={library.source ?? 'personal'}
        disabled
      />
      <TextField label="Local storage" value={library.path} disabled />
      <div class="zds-cloud-library-settings__status">
        <p role={status.value.state === 'error' ? 'alert' : 'status'}>
          {statusText}
        </p>
        {signedIn ? (
          <Button
            icon="refresh"
            label="Sync now"
            disabled={readOnly || status.value.state === 'syncing'}
            onClick={() => void sync.syncLibrary(library).catch(() => {})}
          />
        ) : (
          <Button
            icon="arrowUpRight"
            label="Sign in"
            disabled={readOnly}
            onClick={() =>
              auth.requestSignIn('Sign in to synchronize Personal Cloud.')
            }
          />
        )}
      </div>
    </div>
  )
}
