// Responsive horizontal gutter for primary content bodies (settings right side,
// skills, artifacts, command center / sessions). Ratio-based so it scales with
// the window, but clamped so it never collapses on narrow widths or runs away
// on ultrawide displays. Headers/tabs intentionally keep their own tighter
// padding.
//
// NOTE: these must stay literal strings — Tailwind's scanner only picks up
// complete class names, so do not build them via template interpolation.
export const PAGE_INSET_X = 'px-[clamp(1.25rem,4vw,4rem)]'

// Matching negative inline-margin to bleed an element (e.g. a sticky header bar)
// out to the gutter edges before re-applying PAGE_INSET_X.
export const PAGE_INSET_NEG_X = '-mx-[clamp(1.25rem,4vw,4rem)]'

// Clearance for full-bleed page headers that sit in the titlebar band. The shell
// paints titlebar controls as fixed overlays — without this padding, toolbar
// rows collide with traffic lights / haptics / settings / sidebar toggles.
//
// NOTE: literal strings for Tailwind's scanner (same rule as PAGE_INSET_X).
export const TITLEBAR_CLEARANCE_TOP = 'pt-[calc(var(--titlebar-height)+0.5rem)]'
export const TITLEBAR_CLEARANCE_RIGHT = 'pr-[calc(var(--titlebar-tools-right)+var(--titlebar-tools-width)+0.75rem)]'
