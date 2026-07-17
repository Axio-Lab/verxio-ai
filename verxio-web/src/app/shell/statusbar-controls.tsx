import type { ComponentProps, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// Shared chrome styling for interactive statusbar items (button / link / menu
// trigger). The 'text' variant intentionally omits hover/transition/disabled.
const STATUSBAR_ACTION_CLASS =
  'inline-flex h-full min-w-10 shrink-0 items-center justify-center gap-1 rounded-none px-2 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-45 sm:min-w-0 sm:justify-start sm:px-1.5'

export interface StatusbarMenuItem {
  id: string
  icon?: ReactNode
  label: string
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  onSelect?: () => void
  title?: string
  to?: string
}

export interface StatusbarItem {
  id: string
  label?: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  menuAlign?: 'center' | 'end' | 'start'
  menuClassName?: string
  menuContent?: ReactNode
  menuItems?: readonly StatusbarMenuItem[]
  onSelect?: () => void
  title?: string
  to?: string
  variant?: 'action' | 'link' | 'menu' | 'text'
}

export type StatusbarItemSide = 'left' | 'right'
export type SetStatusbarItemGroup = (id: string, items: readonly StatusbarItem[], side?: StatusbarItemSide) => void

interface StatusbarControlsProps extends ComponentProps<'footer'> {
  leftItems?: readonly StatusbarItem[]
  items?: readonly StatusbarItem[]
}

export function StatusbarControls({ className, leftItems = [], items = [], ...props }: StatusbarControlsProps) {
  const navigate = useNavigate()

  return (
    <footer
      className={cn(
        // Include safe-area so the home indicator doesn't cover Status/Agents/Cron
        // on notched phones when viewport-fit=cover is set.
        'flex h-[calc(2.5rem+env(safe-area-inset-bottom,0px))] shrink-0 items-stretch justify-between gap-1 border-t border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background) px-1 pt-0 pb-[env(safe-area-inset-bottom,0px)] text-(--ui-text-tertiary) [-webkit-app-region:no-drag] sm:h-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:gap-2',
        className
      )}
      {...props}
    >
      <div className="scrollbar-none flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto overscroll-x-contain sm:flex-none sm:overflow-x-clip">
        {leftItems
          .filter(item => !item.hidden)
          .map(item => (
            <StatusbarItemView item={item} key={`left:${item.id}`} navigate={navigate} />
          ))}
      </div>
      <div className="scrollbar-none flex min-w-0 flex-1 justify-end items-stretch gap-0.5 overflow-x-auto overscroll-x-contain sm:flex-none sm:overflow-x-clip">
        {items
          .filter(item => !item.hidden)
          .map(item => (
            <StatusbarItemView item={item} key={`right:${item.id}`} navigate={navigate} />
          ))}
      </div>
    </footer>
  )
}

function StatusbarItemView({ item, navigate }: { item: StatusbarItem; navigate: ReturnType<typeof useNavigate> }) {
  const content = (
    <>
      {item.icon}
      {item.label && <span className={cn('truncate', item.icon && 'hidden sm:inline')}>{item.label}</span>}
      {item.detail && <span className="hidden truncate text-muted-foreground/80 sm:inline">{item.detail}</span>}
    </>
  )

  if (item.variant === 'menu' && (item.menuContent || (item.menuItems && item.menuItems.length > 0))) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={cn(STATUSBAR_ACTION_CLASS, item.className)} disabled={item.disabled} type="button">
            {content}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={item.menuAlign ?? 'start'}
          className={cn('w-56', item.menuContent && 'p-0', item.menuClassName)}
          side="top"
          sideOffset={8}
        >
          {item.menuContent
            ? item.menuContent
            : (item.menuItems ?? [])
                .filter(menuItem => !menuItem.hidden)
                .map(menuItem => (
                  <DropdownMenuItem
                    className={cn('gap-2 text-foreground focus:bg-accent [&_svg]:size-4', menuItem.className)}
                    disabled={menuItem.disabled}
                    key={menuItem.id}
                    onSelect={() => {
                      if (menuItem.to) {
                        navigate(menuItem.to)
                      }

                      menuItem.onSelect?.()
                    }}
                  >
                    {menuItem.href ? (
                      <a
                        className="inline-flex w-full items-center gap-2"
                        href={menuItem.href}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {menuItem.icon}
                        <span className="truncate">{menuItem.label}</span>
                      </a>
                    ) : (
                      <>
                        {menuItem.icon}
                        <span className="truncate">{menuItem.label}</span>
                      </>
                    )}
                  </DropdownMenuItem>
                ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (item.variant === 'text' && !item.onSelect && !item.to && !item.href) {
    return (
      <div
        className={cn(
          'inline-flex h-full min-w-10 shrink-0 items-center justify-center gap-1 px-2 text-[0.6875rem] text-(--ui-text-tertiary) sm:min-w-0 sm:justify-start sm:px-1.5',
          item.className
        )}
      >
        {content}
      </div>
    )
  }

  if (item.href || item.variant === 'link') {
    return (
      <a className={cn(STATUSBAR_ACTION_CLASS, item.className)} href={item.href} rel="noreferrer" target="_blank">
        {content}
      </a>
    )
  }

  return (
    <button
      className={cn(STATUSBAR_ACTION_CLASS, item.className)}
      disabled={item.disabled}
      onClick={() => {
        if (item.to) {
          navigate(item.to)
        }

        item.onSelect?.()
      }}
      type="button"
    >
      {content}
    </button>
  )
}
