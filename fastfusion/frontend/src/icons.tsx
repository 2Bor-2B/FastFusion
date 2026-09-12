/**
 * Inline copies of the handful of Lucide glyphs the interface uses, so the
 * icon set costs nothing at install time and stays in the bundle we control.
 * Same 24x24 grid, stroke width and round caps as the originals.
 */
import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowUp = (props: IconProps) => (
  <Icon {...props}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Icon>
);

export const ArrowUpRight = (props: IconProps) => (
  <Icon {...props}><path d="M7 7h10v10" /><path d="M7 17 17 7" /></Icon>
);

export const Check = (props: IconProps) => (
  <Icon {...props}><path d="M20 6 9 17l-5-5" /></Icon>
);

export const ChevronDown = (props: IconProps) => (
  <Icon {...props}><path d="m6 9 6 6 6-6" /></Icon>
);

export const ChevronRight = (props: IconProps) => (
  <Icon {...props}><path d="m9 18 6-6-6-6" /></Icon>
);

export const Copy = (props: IconProps) => (
  <Icon {...props}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Icon>
);

export const CornerDownLeft = (props: IconProps) => (
  <Icon {...props}><path d="m9 10-5 5 5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></Icon>
);

export const Download = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </Icon>
);

export const Expand = (props: IconProps) => (
  <Icon {...props}>
    <path d="m21 21-6-6m6 6v-4.8m0 4.8h-4.8" />
    <path d="M3 16.2V21m0 0h4.8M3 21l6-6" />
    <path d="M21 7.8V3m0 0h-4.8M21 3l-6 6" />
    <path d="M3 7.8V3m0 0h4.8M3 3l6 6" />
  </Icon>
);

export const GitBranch = (props: IconProps) => (
  <Icon {...props}>
    <line x1="6" x2="6" y1="3" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </Icon>
);

export const Grip = (props: IconProps) => (
  <Icon {...props}>
    {[5, 12, 19].flatMap((cy) => [5, 12, 19].map((cx) => (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" fill="currentColor" />
    )))}
  </Icon>
);

export const LoaderCircle = (props: IconProps) => (
  <Icon {...props}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></Icon>
);

export const Minus = (props: IconProps) => (
  <Icon {...props}><path d="M5 12h14" /></Icon>
);

export const Plus = (props: IconProps) => (
  <Icon {...props}><path d="M5 12h14" /><path d="M12 5v14" /></Icon>
);

export const RotateCcw = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Icon>
);

export const Save = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
    <path d="M7 3v4a1 1 0 0 0 1 1h7" />
  </Icon>
);

export const FolderOpen = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </Icon>
);

export const Square = (props: IconProps) => (
  <Icon {...props}><rect width="18" height="18" x="3" y="3" rx="2" /></Icon>
);

export const Terminal = (props: IconProps) => (
  <Icon {...props}><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></Icon>
);

export const Trophy = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </Icon>
);

export const X = (props: IconProps) => (
  <Icon {...props}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>
);
