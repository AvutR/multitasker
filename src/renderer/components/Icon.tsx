import type { SVGProps } from 'react'

/**
 * One small, opinionated icon set — single 16×16 viewBox, single 1.4 stroke
 * weight, rounded caps. Every interactive surface uses these instead of emoji
 * so the app reads with one consistent visual voice. Color comes from
 * `currentColor`, so callers tint with text-color utilities.
 */
export type IconName = 'resume' | 'done' | 'pin' | 'delete' | 'chevron-right' | 'chevron-down' | 'plus' | 'sparkle'

interface PathSpec {
  d: string
  /** Default fill state for this icon (most are stroke-only). */
  filled?: boolean
}

const PATHS: Record<IconName, PathSpec> = {
  resume:          { d: 'M14 8a6 6 0 1 1-6-6c1.9 0 3.6 .8 4.9 2M14 2v4h-4' },
  done:            { d: 'M3.5 8.5l3 3 6-6' },
  pin:             { d: 'M4 2v12l4-3 4 3V2z', filled: true },
  delete:          { d: 'M3.5 3.5l9 9M12.5 3.5l-9 9' },
  'chevron-right': { d: 'M6 3l5 5-5 5' },
  'chevron-down':  { d: 'M3 6l5 5 5-5' },
  plus:            { d: 'M8 3v10M3 8h10' },
  sparkle:         { d: 'M8 2v3M8 11v3M2 8h3M11 8h3M4.5 4.5l2 2M9.5 9.5l2 2M4.5 11.5l2-2M9.5 6.5l2-2' }
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  /** Pixel size (square). Defaults to 14 — small + quiet by design. */
  size?: number
  /** Override the icon's default fill mode (e.g. show `pin` as outline). */
  filled?: boolean
}

export function Icon({ name, size = 14, filled, ...props }: IconProps) {
  const spec = PATHS[name]
  const useFilled = filled ?? spec.filled ?? false
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={useFilled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={useFilled ? 0 : 1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d={spec.d} />
    </svg>
  )
}
