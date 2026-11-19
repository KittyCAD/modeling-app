import {
  addresses,
  ApiError,
  factory,
  payments,
  type AddressResponse,
} from '@kittycad/lib'
import { factoryEntrypointSubmissionAvailable } from '@src/lib/factory/availability'
import { collectApiPages } from '@src/lib/apiPagination'
import { createKCClient } from '@src/lib/kcClient'
import type {
  FactoryDelivery,
  FactoryJobRequests,
  FactoryPart,
  FactorySnapshot,
  FactoryWriteResult,
} from '@src/lib/factory/jobs'

export interface FactoryShippingForm {
  name: string
  company: string
  phone: string
  street1: string
  street2: string
  city: string
  state: string
  postal_code: string
  country: 'US'
  is_expedited: boolean
}

export const emptyShipping: FactoryShippingForm = {
  name: '',
  company: '',
  phone: '',
  street1: '',
  street2: '',
  city: '',
  state: '',
  postal_code: '',
  country: 'US',
  is_expedited: false,
}

export function shippingFromAddress(
  address: AddressResponse
): FactoryShippingForm {
  return {
    name: address.contact.recipient ?? '',
    company: address.contact.company ?? '',
    phone: address.contact.phone ?? '',
    street1: address.postal.street1,
    street2: address.postal.street2,
    city: address.postal.city,
    state: address.postal.state,
    postal_code: address.postal.zip,
    country: 'US',
    is_expedited: false,
  }
}

export async function loadFactoryOptions(token: string, organization: boolean) {
  const client = createKCClient(token)
  const [materials, finishes, savedAddresses, customer] = await Promise.all([
    collectApiPages(factory.get_user_factory_materials_pager({ client })),
    collectApiPages(factory.get_user_factory_finishes_pager({ client })),
    collectApiPages(
      organization
        ? addresses.list_org_addresses_pager({ client })
        : addresses.list_user_addresses_pager({ client })
    ),
    (organization
      ? payments.get_payment_information_for_org({ client })
      : payments.get_payment_information_for_user({ client })
    ).catch(() => null),
  ])
  const preferred =
    savedAddresses.find(
      (address) =>
        address.is_default_shipping && address.postal.country === 'US'
    ) ??
    savedAddresses.find(
      (address) => address.is_billing && address.postal.country === 'US'
    )
  const address = customer?.address
  const billing =
    address?.country === 'US' && address.street1?.trim() && address.city?.trim()
      ? {
          ...emptyShipping,
          name: customer?.name?.trim() ?? '',
          phone: customer?.phone?.trim() ?? '',
          street1: address.street1.trim(),
          street2: address.street2?.trim() ?? '',
          city: address.city.trim(),
          state: address.state?.trim() ?? '',
          postal_code: address.zip?.trim() ?? '',
        }
      : undefined
  return {
    materials: materials.map(({ name }) => name),
    finishes: finishes.map(({ name }) => name),
    addresses: savedAddresses.filter((item) => item.postal.country === 'US'),
    shipping: preferred
      ? shippingFromAddress(preferred)
      : (billing ?? { ...emptyShipping }),
  }
}

export async function saveFactoryDelivery(
  token: string,
  organization: boolean,
  shipping: FactoryShippingForm
): Promise<FactoryDelivery> {
  const body = {
    is_saved: false,
    contact: {
      recipient: shipping.name,
      company: shipping.company,
      phone: shipping.phone,
    },
    postal: {
      street1: shipping.street1,
      street2: shipping.street2,
      city: shipping.city,
      state: shipping.state,
      zip: shipping.postal_code,
      country: shipping.country,
    },
  }
  const client = createKCClient(token)
  const address = await (organization
    ? addresses.create_org_address({ client, body })
    : addresses.create_user_address({ client, body }))
  return {
    shipping_address_revision_id: address.revision_id,
    is_expedited: shipping.is_expedited,
  }
}

export function factoryJobFiles(
  part: FactoryPart,
  snapshot: FactorySnapshot,
  delivery: FactoryDelivery
) {
  const { entrypoint, ...fields } = part
  return [
    {
      name: 'body',
      data: new Blob(
        [JSON.stringify({ fields, ...delivery, entrypoint_path: entrypoint })],
        { type: 'application/json' }
      ),
    },
    ...snapshot.files.map((file) => ({
      name: file.relativePath,
      data: new File([Uint8Array.from(file.data)], file.relativePath),
    })),
  ]
}

async function write(
  request: () => Promise<{ id: string; status: string }>
): Promise<FactoryWriteResult> {
  try {
    return { ok: true, ...(await request()) }
  } catch (error) {
    const uncertain =
      !(error instanceof ApiError) ||
      error.status >= 500 ||
      error.status === 408
    return {
      ok: false,
      uncertain,
      message: uncertain
        ? 'The response could not be confirmed. Check Manufacturing Jobs on zoo.dev before submitting again to avoid duplicates.'
        : error.message,
    }
  }
}

export function createFactoryRequests(
  token: string,
  organization: boolean
): FactoryJobRequests {
  const client = createKCClient(token)
  return {
    create: (part, snapshot, delivery) =>
      !factoryEntrypointSubmissionAvailable
        ? Promise.resolve({
            ok: false,
            uncertain: false,
            message: 'Factory submissions are not available in this build.',
          })
        : write(() =>
            factory.create_user_factory_job({
              client,
              files: factoryJobFiles(part, snapshot, delivery),
            })
          ),
    revise: (job, part) => {
      const { entrypoint: _entrypoint, ...fields } = part
      const params = {
        client,
        job_id: job.id,
        files: [
          {
            name: 'body',
            data: new Blob([JSON.stringify({ fields, removed_files: [] })], {
              type: 'application/json',
            }),
          },
        ],
      }
      return write(() =>
        organization
          ? factory.create_org_factory_job_version(params)
          : factory.create_user_factory_job_version(params)
      )
    },
  }
}
