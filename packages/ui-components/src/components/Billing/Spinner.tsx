import type { SVGProps } from 'react'
import { classNames } from '../../lib/classNames'

export function Spinner({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      data-testid="spinner"
      viewBox="0 0 10 10"
      className={classNames('kc-billing-spinner', className)}
      {...props}
    >
      <title>spinner</title>
      <circle
        cx="5"
        cy="5"
        r="4"
        stroke="currentColor"
        fill="none"
        strokeDasharray="4, 4"
      />
    </svg>
  )
}
