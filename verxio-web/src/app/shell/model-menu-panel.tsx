import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useMemo, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  dropdownMenuRow,
  DropdownMenuSearch,
  dropdownMenuSectionLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import type { HermesGateway } from '@/hermes'
import { getGlobalModelOptions } from '@/hermes'
import { useI18n } from '@/i18n'
import {
  currentPickerSelection,
  displayModelName,
  modelDisplayParts,
  reasoningEffortLabel
} from '@/lib/model-status-label'
import { cn } from '@/lib/utils'
import { $modelPresets, applyModelPreset, modelPresetKey } from '@/store/model-presets'
import {
  $visibleModels,
  collapseModelFamilies,
  DEFAULT_VISIBLE_PER_PROVIDER,
  effectiveVisibleKeys,
  type ModelFamily,
  modelVisibilityKey,
  setModelVisibilityOpen
} from '@/store/model-visibility'
import {
  $activeSessionId,
  $currentFastMode,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort
} from '@/store/session'
import type { ModelOptionProvider, ModelOptionsResponse } from '@/types/hermes'

import { ModelEditSubmenu, resolveFastControl } from './model-edit-submenu'

export const ModelMenuCloseContext = createContext<() => void>(() => {})

interface ModelMenuPanelProps {
  gateway?: HermesGateway
  onSelectModel: (selection: { model: string; persistGlobal: boolean; provider: string }) => Promise<boolean> | void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

interface ProviderGroup {
  families: ModelFamily[]
  provider: ModelOptionProvider
}

export function ModelMenuPanel({ gateway, onSelectModel, requestGateway }: ModelMenuPanelProps) {
  const { t } = useI18n()
  const copy = t.shell.modelMenu
  const closeMenu = useContext(ModelMenuCloseContext)
  const [search, setSearch] = useState('')
  const activeSessionId = useStore($activeSessionId)
  const currentFastMode = useStore($currentFastMode)
  const currentModel = useStore($currentModel)
  const currentProvider = useStore($currentProvider)
  const currentReasoningEffort = useStore($currentReasoningEffort)
  const modelPresets = useStore($modelPresets)
  const visibleModels = useStore($visibleModels)

  const modelOptions = useQuery({
    queryKey: ['model-options', activeSessionId || 'global'],
    queryFn: (): Promise<ModelOptionsResponse> => {
      if (gateway && activeSessionId) {
        return gateway.request<ModelOptionsResponse>('model.options', { session_id: activeSessionId })
      }

      return getGlobalModelOptions()
    }
  })

  const { model: optionsModel, provider: optionsProvider } = currentPickerSelection(
    !!activeSessionId,
    { model: currentModel, provider: currentProvider },
    modelOptions.data
  )

  const loading = modelOptions.isPending && !modelOptions.data

  const error = modelOptions.error
    ? modelOptions.error instanceof Error
      ? modelOptions.error.message
      : String(modelOptions.error)
    : null

  const providers = modelOptions.data?.providers

  const effectiveVisibleModels = useMemo(
    () => effectiveVisibleKeys(visibleModels, providers ?? []),
    [visibleModels, providers]
  )

  const switchTo = (model: string, provider: string) =>
    onSelectModel({ model, persistGlobal: !activeSessionId, provider })

  const selectFamily = async (family: ModelFamily, provider: ModelOptionProvider) => {
    const caps = provider.capabilities?.[family.id]
    const preset = modelPresets[modelPresetKey(provider.slug, family.id)] ?? {}
    const variantFast = !(caps?.fast ?? false) && !!family.fastId
    const targetId = variantFast && preset.fast === true ? family.fastId! : family.id

    if ((await switchTo(targetId, provider.slug)) === false) {
      return
    }

    await applyModelPreset(
      {
        effort: (caps?.reasoning ?? true) ? (preset.effort ?? 'medium') : undefined,
        fast: (caps?.fast ?? false) ? (preset.fast ?? false) : undefined
      },
      { failMessage: t.shell.modelOptions.updateFailed, request: requestGateway, sessionId: activeSessionId }
    )
  }

  const groups = useMemo(
    () =>
      groupModels(providers ?? [], search, { model: optionsModel, provider: optionsProvider }, effectiveVisibleModels),
    [providers, search, optionsModel, optionsProvider, effectiveVisibleModels]
  )

  return (
    <>
      <DropdownMenuSearch aria-label={copy.search} onValueChange={setSearch} placeholder={copy.search} value={search} />

      <DropdownMenuSeparator className="mx-0" />

      {loading ? (
        <DropdownMenuGroup className="py-1">
          {Array.from({ length: 4 }, (_, index) => (
            <DropdownMenuItem
              className={dropdownMenuRow}
              disabled
              key={index}
              onSelect={event => event.preventDefault()}
            >
              <Skeleton className="h-4 w-full" />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ) : error ? (
        <DropdownMenuItem className={dropdownMenuRow} disabled>
          {error}
        </DropdownMenuItem>
      ) : groups.length === 0 ? (
        <DropdownMenuItem className={dropdownMenuRow} disabled>
          {copy.noModels}
        </DropdownMenuItem>
      ) : (
        <div className="max-h-80 overflow-y-auto py-0.5">
          {groups.map(group => (
            <DropdownMenuGroup className="py-0.5" key={group.provider.slug}>
              <DropdownMenuLabel className={dropdownMenuSectionLabel}>{group.provider.name}</DropdownMenuLabel>
              {group.families.map(family => {
                // The active id may be the base or its -fast sibling; either
                // way this one family row represents both.
                const activeId =
                  group.provider.slug === optionsProvider &&
                  (optionsModel === family.id || optionsModel === family.fastId)
                    ? optionsModel
                    : null

                const isCurrent = activeId !== null
                const name = modelDisplayParts(family.id).name
                // Capabilities are looked up against the active/base id; the
                // -fast variant carries the same param support as its base.
                const caps = group.provider.capabilities?.[family.id]

                const preset = modelPresets[modelPresetKey(group.provider.slug, family.id)] ?? {}
                const effEffort = isCurrent ? currentReasoningEffort : (preset.effort ?? '')
                const effFast = isCurrent ? currentFastMode : (preset.fast ?? false)

                const fastControl = resolveFastControl(
                  activeId ?? family.id,
                  group.provider.models ?? [],
                  caps?.fast ?? false,
                  effFast
                )

                const meta = [
                  fastControl.kind !== 'none' && fastControl.on ? copy.fast : null,
                  (caps?.reasoning ?? true) ? reasoningEffortLabel(effEffort) || copy.medium : null
                ]
                  .filter(Boolean)
                  .join(' ')

                const activate = () => {
                  if (!isCurrent) {
                    void selectFamily(family, group.provider)
                  }

                  closeMenu()
                }

                return (
                  <DropdownMenuSub key={`${group.provider.slug}:${family.id}`}>
                    <DropdownMenuSubTrigger
                      className={dropdownMenuRow}
                      hideChevron
                      onClick={activate}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          activate()
                        }
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {name}
                        {meta ? <span className="text-(--ui-text-tertiary)"> {meta}</span> : null}
                      </span>
                      {isCurrent ? <Codicon className="ml-auto text-foreground" name="check" size="0.75rem" /> : null}
                    </DropdownMenuSubTrigger>
                    <ModelEditSubmenu
                      effort={effEffort}
                      fastControl={fastControl}
                      isActive={isCurrent}
                      model={family.id}
                      onSelectModel={nextModel => switchTo(nextModel, group.provider.slug)}
                      provider={group.provider.slug}
                      reasoning={caps?.reasoning ?? true}
                      requestGateway={requestGateway}
                    />
                  </DropdownMenuSub>
                )
              })}
            </DropdownMenuGroup>
          ))}
        </div>
      )}

      <DropdownMenuSeparator className="mx-0" />

      <DropdownMenuItem
        className={cn(dropdownMenuRow, 'text-(--ui-text-tertiary)')}
        onSelect={() => setModelVisibilityOpen(true)}
      >
        {copy.editModels}
      </DropdownMenuItem>
    </>
  )
}

// Collapsed we show the user's chosen models (or the curated default); typing
// spans every available model so anything is reachable past the cut.
const PER_PROVIDER_SEARCH = 12

function groupModels(
  providers: ModelOptionProvider[],
  search: string,
  current: { model: string; provider: string },
  visible: Set<string> | null
): ProviderGroup[] {
  const q = search.trim().toLowerCase()
  const groups: ProviderGroup[] = []

  for (const provider of providers) {
    const allFamilies = collapseModelFamilies(provider.models ?? [])

    if (allFamilies.length === 0) {
      continue
    }

    const matches = (family: ModelFamily) =>
      `${family.id} ${family.fastId ?? ''} ${provider.name} ${provider.slug} ${displayModelName(family.id)}`
        .toLowerCase()
        .includes(q)

    // Which model ids to show (the active one is always added on top of this).
    let shown: Set<string>

    if (q) {
      // Search spans every family, regardless of visibility.
      shown = new Set(allFamilies.filter(matches).map(family => family.id))
    } else if (visible) {
      // User has customized which models show — honor their selection exactly.
      shown = new Set(
        allFamilies.filter(family => visible.has(modelVisibilityKey(provider.slug, family.id))).map(family => family.id)
      )
    } else {
      // Default: curated top-N families per provider.
      shown = new Set(allFamilies.slice(0, DEFAULT_VISIBLE_PER_PROVIDER).map(family => family.id))
    }

    // Always include the active model — but keep every row in the provider's
    // stable curated order (filter `allFamilies`, never reorder), so selecting
    // a model can't shuffle the list.
    const activeId =
      provider.slug === current.provider && current.model
        ? allFamilies.find(family => family.id === current.model || family.fastId === current.model)?.id
        : undefined

    let families = allFamilies.filter(family => shown.has(family.id) || family.id === activeId)

    if (q) {
      families = families.slice(0, PER_PROVIDER_SEARCH)
    }

    if (families.length > 0) {
      groups.push({ families, provider })
    }
  }

  // Stable, logical group order: alphabetical by provider name. (The backend
  // floats the current provider first, which would reshuffle on every switch.)
  groups.sort((a, b) => a.provider.name.localeCompare(b.provider.name))

  return groups
}
