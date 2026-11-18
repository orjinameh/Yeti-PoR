// Inline SVG icons for the console keys. No emoji anywhere in the UI.
import type { ReactNode } from "react";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const wrap = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" {...S}>{children}</svg>
);

export const Icon = {
  speaker: (off: boolean) => wrap(<>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" stroke="none" />
    {off ? <path d="M16 9l5 6M21 9l-5 6" /> : <><path d="M15.5 9a4 4 0 010 6" /><path d="M18 6.5a8 8 0 010 11" /></>}
  </>),
  note: (off: boolean) => wrap(<>
    <path d="M9 17.5V6l10-2v11.5" />
    <circle cx="6.5" cy="17.5" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="16.5" cy="15.5" r="2.5" fill="currentColor" stroke="none" />
    {off && <path d="M3 3l18 18" />}
  </>),
  pause: () => wrap(<><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /></>),
  play: () => wrap(<path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" stroke="currentColor" />),
  up: () => wrap(<path d="M5 15l7-7 7 7" strokeWidth={3} />),
  trophy: () => wrap(<><path d="M7 4h10v4.5a5 5 0 01-10 0V4z" /><path d="M7 6H4.5v1.5A3 3 0 007.5 10.5M17 6h2.5v1.5a3 3 0 01-3 3" /><path d="M12 13.5V17M8.5 20h7M10 17h4" /></>),
};

/** original mark: two rounded peaks inside a rounded badge */
export function Mark({ size = 64 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="mk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bfe8ff" /><stop offset="1" stopColor="#3f8fd6" /></linearGradient>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="18" fill="#0d1630" stroke="url(#mk)" strokeWidth="3" />
      <path d="M12 46L26 22l8 12 6-9 12 21z" fill="url(#mk)" stroke="url(#mk)" strokeWidth="5" strokeLinejoin="round" />
      <circle cx="46" cy="18" r="3.4" fill="#ffd2a0" />
    </svg>
  );
}
