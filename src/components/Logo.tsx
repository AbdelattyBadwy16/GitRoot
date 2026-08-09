interface LogoProps {
  size?: number;
  glow?: boolean;
  className?: string;
}

// the GitRoot mark: a root commit branching into two colored lines
export default function Logo({ size = 40, glow = true, className }: LogoProps) {
  const glowId = "gitroot-logo-glow";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="GitRoot"
    >
      <defs>
        {glow && (
          <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <g filter={glow ? `url(#${glowId})` : undefined}>
        <path
          d="M 50 75 C 50 55 30 45 25 29"
          fill="none"
          stroke="var(--lane-3)"
          strokeWidth={9}
          strokeLinecap="round"
        />
        <path
          d="M 50 75 C 50 55 70 45 75 29"
          fill="none"
          stroke="var(--lane-2)"
          strokeWidth={9}
          strokeLinecap="round"
        />
        <circle cx={50} cy={82} r={8.5} fill="var(--lane-1)" />
        <circle cx={25} cy={26} r={7} fill="var(--lane-3)" />
        <circle cx={75} cy={26} r={7} fill="var(--lane-2)" />
      </g>
    </svg>
  );
}
