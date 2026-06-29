/**
 * Adapted from https://github.com/KittyCAD/text-to-cad-ui/blob/309a2e756732b7b9a2b095d6a0f99bc23872d542/src/lib/billing.ts
 */

import {
  type Client,
  type CustomerBalance,
  type UserOrgInfo,
  type ZooProductSubscriptions,
  orgs,
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

  const org = await fetchBilling<UserOrgInfo, { client: Client }>(
    orgs.get_user_org,
    { client }
  )
  const hasOrgError = BillingError.from(org)
  const payAsYouGoApiCreditPrice = BillingError.from(subscriptions)
    ? undefined
    : subscriptions.modeling_app.pay_as_you_go_api_credit_price

  if (!hasOrgError) {
    return {
      balance: Number.POSITIVE_INFINITY,
      userPaymentBalance: billing,
      payAsYouGoApiCreditPrice,
      isOrg: true,
      hasSubscription: true,
    }
  }

  if (BillingError.from(subscriptions)) {
    return subscriptions
  }

  const tier = subscriptions.modeling_app.name
  const ratioSec = subscriptions.modeling_app.pay_as_you_go_api_credit_price
  const toMinutes = (value: number, ratioSec: number) => value / ratioSec / 60
  const computedAllowance =
    subscriptions.modeling_app.monthly_pay_as_you_go_api_credits_monetary_value
  let balance = 0
  let allowance: number | undefined
  let hasSubscription = false
  let isOrg = false

  switch (tier) {
    case 'enterprise':
    case 'team':
      balance = Number.POSITIVE_INFINITY
      hasSubscription = true
      isOrg = true
      break
    case 'pro':
      balance = Number.POSITIVE_INFINITY
      hasSubscription = true
      isOrg = false
      break
    case 'plus':
      if (ratioSec === undefined || computedAllowance === undefined) {
        return createInvalidBillingDataError(
          'Missing ratioSec or computedAllowance for plus tier'
        )
      }
      allowance = toMinutes(computedAllowance, ratioSec)
      balance = toMinutes(
        billing.monthly_api_credits_remaining_monetary_value +
          billing.stable_api_credits_remaining_monetary_value,
        ratioSec
      )
      isOrg = false
      hasSubscription = true
      break
    case 'free':
      if (ratioSec === undefined || computedAllowance === undefined) {
        return createInvalidBillingDataError(
          'Missing ratioSec or computedAllowance for free tier'
        )
      }
      allowance = toMinutes(computedAllowance, ratioSec)
      balance = toMinutes(
        billing.monthly_api_credits_remaining_monetary_value +
          billing.stable_api_credits_remaining_monetary_value,
        ratioSec
      )
      isOrg = false
      hasSubscription = false
      break
    default: {
      return createInvalidBillingDataError(
        `Unhandled subscription tier: ${tier}`
      )
    }
  }

  return {
    balance,
    allowance,
    userPaymentBalance: billing,
    payAsYouGoApiCreditPrice: ratioSec,
    hasSubscription,
    isOrg,
  }
}
