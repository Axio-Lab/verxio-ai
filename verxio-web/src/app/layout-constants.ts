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

// Overlay split layouts (Settings, Command Center, Profiles) stack the sidebar
// above content below Tailwind `xl` (80rem / 1280px). The old 47.5rem cutoff
// left tablet widths in a cramped two-column grid; `lg` (1024px) was still too
// tight once a 13rem sidebar and ListRow action column are accounted for.
export const OVERLAY_SPLIT_STACK = 'max-xl:grid-cols-1 max-xl:grid-rows-[auto_minmax(0,1fr)]' as const

export const OVERLAY_SIDEBAR_STACK =
  'max-xl:flex-row max-xl:flex-wrap max-xl:items-center max-xl:gap-1 max-xl:overflow-x-auto max-xl:overflow-y-hidden max-xl:shrink-0 max-xl:border-b max-xl:border-border/30 max-xl:px-3 max-xl:pb-2 max-xl:pt-[calc(var(--titlebar-height)+0.5rem)]' as const

export const OVERLAY_NAV_ITEM_STACK = 'max-xl:h-auto max-xl:w-auto max-xl:shrink-0 max-xl:whitespace-nowrap' as const

// Full-width banners (e.g. Leash identity) sit below the fixed titlebar — only
// top margin is needed to clear the control strip; horizontal inset is modest
// padding because titlebar icons are not beside the banner body.
export const LEASH_BANNER_CLEARANCE_TOP = 'mt-[var(--titlebar-height)]'
export const LEASH_BANNER_PADDING_X = 'px-3 sm:px-4'
