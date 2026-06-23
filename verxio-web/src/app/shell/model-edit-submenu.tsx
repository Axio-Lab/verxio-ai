import { useStore } from '@nanostores/react'

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  dropdownMenuRow,
  dropdownMenuSectionLabel,
  DropdownMenuSeparator,
  DropdownMenuSubContent
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { setModelPreset } from '@/store/model-presets'
import { notifyError } from '@/store/notifications'
import { $activeSessionId, setCurrentFastMode, setCurrentReasoningEffort } from '@/store/session'

// Verxio real reasoning levels (see VALID_REASONING_EFFORTS); `none` is owned
// by the Thinking toggle, not the radio.
const EFFORT_OPTIONS = [
  { value: 'minimal', labelKey: 'minimal' },
  { value: 'low', labelKey: 'low' },
  { value: 'medium', labelKey: 'medium' },
  { value: 'high', labelKey: 'high' },
  { value: 'xhigh', labelKey: 'max' }
] as const

/** How "fast" is achieved for a given model — two different mechanisms:
 *  - `param`: the Anthropic/OpenAI `speed=fast` request parameter.
 *  - `variant`: a separate `…-fast` sibling model selected via the model field.
 */
export type FastControl =
  | { kind: 'none' }
  | { kind: 'param'; on: boolean }
  | { kind: 'variant'; baseId: string; fastId: string; on: boolean }

/** Resolve the fast mechanism for a model: prefer the speed=fast parameter
 *  when the backend supports it, else fall back to a `…-fast` sibling model. */
export function resolveFastControl(
  model: string,
  providerModels: readonly string[],
  paramSupported: boolean,
  currentFastMode: boolean
): FastControl {
  if (paramSupported) {
    return { kind: 'param', on: currentFastMode }
  }

  if (/-fast$/i.test(model)) {
    const baseId = model.replace(/-fast$/i, '')

    return providerModels.includes(baseId) ? { kind: 'variant', baseId, fastId: model, on: true } : { kind: 'none' }
  }

  const fastId = `${model}-fast`

  if (providerModels.includes(fastId)) {
    return { kind: 'variant', baseId: model, fastId, on: false }
  }

  if (currentFastMode) {
    return { kind: 'param', on: true }
  }

  return { kind: 'none' }
}

interface ModelEditSubmenuProps {
  effort: string
  fastControl: FastControl
  isActive: boolean
  model: string
  onSelectModel: (model: string) => Promise<boolean> | void
  provider: string
  reasoning: boolean
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

export function ModelEditSubmenu({
  effort,
  fastControl,
  isActive,
  model,
  onSelectModel,
  provider,
  reasoning,
  requestGateway
}: ModelEditSubmenuProps) {
  const { t } = useI18n()
  const copy = t.shell.modelOptions
  const activeSessionId = useStore($activeSessionId)

  const effortValue = normalizeEffort(effort)
  const thinkingOn = isThinkingEnabled(effort)

  const patchReasoning = async (next: string) => {
    setModelPreset(provider, model, { effort: next })

    if (!isActive) {
      return
    }

    setCurrentReasoningEffort(next)

    if (!activeSessionId) {
      return
    }

    try {
      await requestGateway('config.set', { key: 'reasoning', session_id: activeSessionId, value: next })
    } catch (err) {
      setCurrentReasoningEffort(effort)
      setModelPreset(provider, model, { effort })
      notifyError(err, copy.updateFailed)
    }
  }

  const toggleFast = (enabled: boolean) => {
    if (fastControl.kind === 'variant') {
      setModelPreset(provider, fastControl.baseId, { fast: enabled })

      if (isActive) {
        void onSelectModel(enabled ? fastControl.fastId : fastControl.baseId)
      }

      return
    }

    if (fastControl.kind === 'param') {
      setModelPreset(provider, model, { fast: enabled })

      if (!isActive) {
        return
      }

      setCurrentFastMode(enabled)

      if (!activeSessionId) {
        return
      }
      void (async () => {
        try {
          await requestGateway('config.set', {
            key: 'fast',
            session_id: activeSessionId,
            value: enabled ? 'fast' : 'normal'
          })
        } catch (err) {
          setCurrentFastMode(!enabled)
          setModelPreset(provider, model, { fast: !enabled })
          notifyError(err, copy.fastFailed)
        }
      })()
    }
  }

  const hasFast = fastControl.kind !== 'none'
  const fastOn = fastControl.kind === 'none' ? false : fastControl.on

  return (
    <DropdownMenuSubContent className="w-52 p-0" sideOffset={4}>
      {!hasFast && !reasoning ? (
        <div className="px-2.5 py-3 text-xs text-(--ui-text-tertiary)">{copy.noOptions}</div>
      ) : (
        <>
          <DropdownMenuLabel className={dropdownMenuSectionLabel}>{copy.options}</DropdownMenuLabel>
          {reasoning ? (
            <DropdownMenuItem className={dropdownMenuRow} onSelect={event => event.preventDefault()}>
              {copy.thinking}
              <Switch
                checked={thinkingOn}
                className="ml-auto"
                onCheckedChange={checked => void patchReasoning(checked ? effortValue || 'medium' : 'none')}
                size="xs"
              />
            </DropdownMenuItem>
          ) : null}
          {hasFast ? (
            <DropdownMenuItem className={dropdownMenuRow} onSelect={event => event.preventDefault()}>
              {copy.fast}
              <Switch checked={fastOn} className="ml-auto" onCheckedChange={toggleFast} size="xs" />
            </DropdownMenuItem>
          ) : null}
          {reasoning ? (
            <>
              <DropdownMenuSeparator className="mx-0" />
              <DropdownMenuLabel className={dropdownMenuSectionLabel}>{copy.effort}</DropdownMenuLabel>
              <DropdownMenuRadioGroup onValueChange={value => void patchReasoning(value)} value={effortValue}>
                {EFFORT_OPTIONS.map(option => (
                  <DropdownMenuRadioItem
                    className={dropdownMenuRow}
                    key={option.value}
                    onSelect={event => event.preventDefault()}
                    value={option.value}
                  >
                    {copy[option.labelKey]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : null}
        </>
      )}
    </DropdownMenuSubContent>
  )
}

function isThinkingEnabled(effort: string): boolean {
  return (effort || 'medium').trim().toLowerCase() !== 'none'
}

function normalizeEffort(effort: string): string {
  const value = (effort || 'medium').trim().toLowerCase()

  if (value === 'none') {
    return ''
  }

  return EFFORT_OPTIONS.some(option => option.value === value) ? value : 'medium'
}
