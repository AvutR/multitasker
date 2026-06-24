/**
 * The little agent critter that hovers on the file an agent is touching — a
 * friendly "you are here" marker, tinted to the task's color. It bobs/pulses
 * while a file call is in flight.
 */
export function AgentMascot({
  color,
  running = false,
  title,
  size = 16
}: {
  color: string
  running?: boolean
  title?: string
  size?: number
}) {
  return (
    <span
      title={title}
      className={`relative inline-flex shrink-0 items-center justify-center ${running ? 'animate-bounce' : ''}`}
      style={{ width: size, height: size, animationDuration: '1.4s' }}
    >
      {running && (
        <span className="absolute inset-0 rounded-full opacity-40 blur-[3px]" style={{ background: color }} />
      )}
      <svg viewBox="0 0 24 24" width={size} height={size} className="relative">
        {/* antenna */}
        <line x1="12" y1="1.5" x2="12" y2="6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12" cy="2" r="1.6" fill={color} />
        {/* body */}
        <rect x="3.5" y="6" width="17" height="14" rx="5.5" fill={color} fillOpacity="0.95" />
        {/* feet */}
        <rect x="7" y="19" width="3" height="3" rx="1.2" fill={color} fillOpacity="0.8" />
        <rect x="14" y="19" width="3" height="3" rx="1.2" fill={color} fillOpacity="0.8" />
        {/* eyes */}
        <circle cx="8.8" cy="12.5" r="2" fill="#0b0e14" />
        <circle cx="15.2" cy="12.5" r="2" fill="#0b0e14" />
        <circle cx="9.5" cy="11.8" r="0.7" fill="#fff" />
        <circle cx="15.9" cy="11.8" r="0.7" fill="#fff" />
      </svg>
    </span>
  )
}
