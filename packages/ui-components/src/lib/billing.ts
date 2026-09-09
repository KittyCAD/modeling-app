/**
 * Adapted from https://github.com/KittyCAD/text-to-cad-ui/blob/309a2e756732b7b9a2b095d6a0f99bc23872d542/src/lib/billing.ts
 */

import {
  type Client,
  type CustomerBalance,
  type ZooProductSubscriptions,
  payments,
} from '@kittycad/lib'

export enum EBillingError {
  NotOk = 'NotOk',
  UnexpectedStatus = 'UnexpectedStatus',
  CatastrophicRequest = 'CatastrophicRequest',
  JSONParse = 'JSONParse',
  InvalidData = 'InvalidData',
}

export interface IBillingErrorNotOk {
  type: EBillingError.NotOk
  data: string
  response: object
  message: string
}

export interface IBillingErrorUnexpectedStatus {
  type: EBillingError.UnexpectedStatus
  code: number
}

export interface IBillingErrorCatastrophicRequest {
  type: EBillingError.CatastrophicRequest
  url?: string
}

export interface IBillingErrorJSONParse {
  type: EBillingError.JSONParse
  error: Error
}

export interface IBillingErrorInvalidData {
  type: EBillingError.InvalidData
  message: string
}

export type _IBillingError =
  | IBillingErrorNotOk
  | IBillingErrorUnexpectedStatus
  | IBillingErrorCatastrophicRequest
  | IBillingErrorJSONParse
  | IBillingErrorInvalidData
export type IBillingError = _IBillingError extends { type: EBillingError }
  ? _IBillingError
  : never

export class BillingError {
  constructor(public error: IBillingError) {}

  static from(v: unknown): v is BillingError {
    return (
      typeof v === 'object' &&
      v !== null &&
      'error' in v &&
      typeof v.error === 'object' &&
      v.error !== null &&
      'type' in v.error &&
      Object.values(EBillingError).some(
        (x) =>
          x ===
          (typeof v.error === 'object' &&
            v.error !== null &&
            'type' in v.error &&
            v.error.type)
      )
    )
  }
}

export interface IBillingInfo {
  balance: number
  allowance?: number
  userPaymentBalance?: CustomerBalance
  payAsYouGoApiCreditPrice?: number
  isOrg: boolean
  hasSubscription: boolean
}

async function fetchBilling<T, TT>(
  fn: (args: TT) => Promise<T>,
  options: TT
): Promise<T | BillingError> {
  try {
    const response = await fn(options)
    if (response === null) {
      return new BillingError({
        type: EBillingError.CatastrophicRequest,
      })
    }

    if (typeof response === 'number') {
      return new BillingError({
        type: EBillingError.UnexpectedStatus,
        code: Number(response),
      })
    }

    return response
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e && 'body' in e) {
      const fallbackErrorMessage = `Failed to request endpoint: ${e.status}`
      const data = e.body
      const resolvedMessage =
        data instanceof Object && 'message' in data
          ? (data.message as string)
          : fallbackErrorMessage

      return new BillingError({
        type: EBillingError.NotOk,
        response: e,
        data: JSON.stringify(data),
        message: resolvedMessage,
      })
    }

    if (e instanceof SyntaxError) {
      return new BillingError({
        type: EBillingError.JSONParse,
        error: e,
      })
    }

    return new BillingError({
      type: EBillingError.CatastrophicRequest,
    })
  }
}

function createInvalidBillingDataError(message: string): BillingError {
  return new BillingError({
    type: EBillingError.InvalidData,
    message,
  })
}

export async function getBillingInfo(
  client: Client
): Promise<BillingError | IBillingInfo> {
  const billing = await fetchBilling<
    CustomerBalance,
    { client: Client; include_total_due: boolean }
  >(payments.get_payment_balance_for_user, { client, include_total_due: true })

  if (BillingError.from(billing)) {
    return billing
  }

  const subscriptions = await fetchBilling<
    ZooProductSubscriptions,
    { client: Client }
  >(payments.get_user_subscription, { client })

  if (BillingError.from(subscriptions)) {
    return subscriptions
  }

  const isOrg = subscriptions.modeling_app.type.type === 'organization'
  const tier = subscriptions.modeling_app.name
  const ratioSec = subscriptions.modeling_app.pay_as_you_go_api_credit_price

  if (isOrg || tier === 'pro') {
    return {
      balance: Number.POSITIVE_INFINITY,
      userPaymentBalance: billing,
      payAsYouGoApiCreditPrice: ratioSec,
      isOrg,
      hasSubscription: true,
    }
  }

  if (tier !== 'free' && tier !== 'plus') {
    return createInvalidBillingDataError(`Unhandled subscription tier: ${tier}`)
  }

  const toMinutes = (value: number, ratioSec: number) => value / ratioSec / 60
  const computedAllowance =
    subscriptions.modeling_app.monthly_pay_as_you_go_api_credits_monetary_value

  if (ratioSec === undefined || computedAllowance === undefined) {
    return createInvalidBillingDataError(
      `Missing ratioSec or computedAllowance for ${tier} tier`
    )
  }

  return {
    balance: toMinutes(
      billing.monthly_api_credits_remaining_monetary_value +
        billing.stable_api_credits_remaining_monetary_value,
      ratioSec
    ),
    allowance: toMinutes(computedAllowance, ratioSec),
    userPaymentBalance: billing,
    payAsYouGoApiCreditPrice: ratioSec,
    hasSubscription: tier === 'plus',
    isOrg,
  }
}
