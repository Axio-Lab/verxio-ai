// Shared chrome for the top-center floating HUDs (command palette + session
// switcher). They pin just under the title bar, centered, and lean on a crisp
// border + shadow to separate from the app — no dimming/blurring backdrop.
// Each caller layers on its own z-index, width, and overflow.
export const HUD_POSITION = 'fixed left-1/2 top-3 -translate-x-1/2'

// Matches the app's borderless-overlay surface (dialog, keybind panel, …):
// hairline `--stroke-nous` paired with the soft `--shadow-nous` float.
export const HUD_SURFACE = 'rounded-xl border border-(--stroke-nous) bg-(--ui-chat-bubble-background) shadow-nous'

// One row/text size for both HUDs (compact — two notches under `text-sm`).
export const HUD_TEXT = 'text-xs'

// Shared item layout + padding for both HUDs. Tight vertical rhythm so rows
// don't feel chunky; overrides the shadcn `CommandItem` default (`px-2 py-1.5`).
export const HUD_ITEM = 'gap-2 px-2 py-1'
