import { deserialize_files } from 'wasm-lib/pkg/wasm_lib'
import { ModelingAppFile } from './exportSave'
import { machineManager } from './singletons'
import toast from 'react-hot-toast'
import { components } from './machine-api'

// Make files locally from an export call.
export async function exportMake(data: ArrayBuffer) {
  const machines = machineManager.machines
  if (machines.length === 0) {
    console.log('No machines available')
    toast.error('No machines available')
    return
  }

  const machineApiIp = machineManager.machineApiIp
  if (!machineApiIp) {
    console.log('No machine api ip available')
    toast.error('No machine api ip available')
    return
  }

  // Grab the first machine.
  const machine = machines[0]
  let machineId = ''
  if ('id' in machine) {
    machineId = machine.id
  } else if ('hostname' in machine && machine.hostname) {
    machineId = machine.hostname
  } else if ('ip' in machine) {
    machineId = machine.ip
  }

  if (machineId === '') {
    console.log('No machine id found')
    toast.error('No machine id found')
    return
  }
  const params: components['schemas']['PrintParameters'] = {
    machine_id: machineId,
    job_name: 'Exported Job', // TODO: make this the project name.
  }
  const formData = new FormData()
  formData.append('params', JSON.stringify(params))
  let files: ModelingAppFile[] = deserialize_files(new Uint8Array(data))
  let file = files[0]
  const fileBlob = new Blob([new Uint8Array(file.contents)], {
    type: 'text/plain',
  })
  formData.append('file', fileBlob, file.name)

  const response = await fetch('http://' + machineApiIp + '/print', {
    mode: 'no-cors',
    method: 'POST',
    body: formData,
  })

  return response
}
