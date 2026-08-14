import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2 } from '@/lib/icons'
import type { SdrFunnelFollowUp, SdrFunnelRule, SdrFunnelRules } from '@/lib/verxio-api'

function emptyRule(): SdrFunnelRule {
  return {
    triggers: [],
    questionsEnabled: true,
    questions: [''],
    summary: '',
    assetUrl: '',
    assetLabel: '',
    maxAgentReplies: 3,
    branches: [],
    followUpEnabled: false,
    followUps: []
  }
}

function emptyFollowUp(): SdrFunnelFollowUp {
  return {
    message: '',
    useCustomMessage: true,
    delayMinutes: 30,
    sendAt: '',
    ctaUrl: ''
  }
}

function csv(values: string[] | undefined): string {
  return (values ?? []).join(', ')
}

function fromCsv(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

export function SdrFunnelEditor({
  disabled,
  onChange,
  value
}: {
  disabled?: boolean
  onChange: (value: SdrFunnelRules) => void
  value?: SdrFunnelRules | null
}) {
  const rules = useMemo(() => value?.rules ?? [], [value])

  const updateRule = (index: number, patch: Partial<SdrFunnelRule>) => {
    onChange({
      rules: rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule))
    })
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Funnel rules</h3>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            Keywords start a qualification path. Answers can branch to an asset, then follow-ups fire on messaging
            channels only.
          </p>
        </div>
        <Button
          disabled={disabled}
          onClick={() => onChange({ rules: [...rules, emptyRule()] })}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus className="size-4" />
          Add rule
        </Button>
      </div>
      {rules.length === 0 ? (
        <p className="rounded-md border border-dashed border-(--stroke-nous) px-3 py-6 text-center text-[0.7rem] text-muted-foreground">
          No funnel rules yet. Add a keyword trigger to start qualifying inbound chats.
        </p>
      ) : null}
      {rules.map((rule, index) => (
        <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-3" key={`${rule.id ?? 'rule'}-${index}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">Rule {index + 1}</span>
            <Button
              disabled={disabled}
              onClick={() => onChange({ rules: rules.filter((_, ruleIndex) => ruleIndex !== index) })}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <label className="grid gap-1.5 text-xs font-medium">
            Triggers
            <Input
              disabled={disabled}
              onChange={event => updateRule(index, { triggers: fromCsv(event.target.value) })}
              placeholder="pricing, demo, enterprise"
              value={csv(rule.triggers)}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-xs font-medium">
            Ask qualification questions
            <Switch
              checked={Boolean(rule.questionsEnabled)}
              disabled={disabled}
              onCheckedChange={checked => updateRule(index, { questionsEnabled: checked })}
            />
          </label>
          {rule.questionsEnabled ? (
            <label className="grid gap-1.5 text-xs font-medium">
              Questions (one per line)
              <Textarea
                className="min-h-20"
                disabled={disabled}
                onChange={event =>
                  updateRule(index, {
                    questions: event.target.value
                      .split('\n')
                      .map(item => item.trim())
                      .filter(Boolean)
                  })
                }
                placeholder={'What is your company size?\nWhen do you want to start?'}
                value={(rule.questions ?? []).join('\n')}
              />
            </label>
          ) : null}
          <label className="grid gap-1.5 text-xs font-medium">
            Summary / CTA
            <Textarea
              className="min-h-16"
              disabled={disabled}
              onChange={event => updateRule(index, { summary: event.target.value })}
              placeholder="Here is the pricing guide for {{answer1}} teams."
              value={rule.summary}
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-medium">
              Asset URL
              <Input
                disabled={disabled}
                onChange={event => updateRule(index, { assetUrl: event.target.value })}
                placeholder="https://..."
                value={rule.assetUrl ?? ''}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium">
              Asset label
              <Input
                disabled={disabled}
                onChange={event => updateRule(index, { assetLabel: event.target.value })}
                placeholder="Pricing guide"
                value={rule.assetLabel ?? ''}
              />
            </label>
          </div>
          <label className="grid gap-1.5 text-xs font-medium">
            Max agent replies
            <Input
              disabled={disabled}
              min={1}
              onChange={event => updateRule(index, { maxAgentReplies: Number(event.target.value) || 3 })}
              type="number"
              value={rule.maxAgentReplies ?? 3}
            />
          </label>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Branches</span>
              <Button
                disabled={disabled}
                onClick={() =>
                  updateRule(index, {
                    branches: [
                      ...(rule.branches ?? []),
                      { matchKeywords: [], summary: '', assetUrl: '', assetLabel: '' }
                    ]
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                Add branch
              </Button>
            </div>
            {(rule.branches ?? []).map((branch, branchIndex) => (
              <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-2" key={`branch-${branchIndex}`}>
                <Input
                  disabled={disabled}
                  onChange={event => {
                    const branches = [...(rule.branches ?? [])]
                    branches[branchIndex] = { ...branch, matchKeywords: fromCsv(event.target.value) }
                    updateRule(index, { branches })
                  }}
                  placeholder="Match keywords: enterprise, 200+"
                  value={csv(branch.matchKeywords)}
                />
                <Input
                  disabled={disabled}
                  onChange={event => {
                    const branches = [...(rule.branches ?? [])]
                    branches[branchIndex] = { ...branch, summary: event.target.value }
                    updateRule(index, { branches })
                  }}
                  placeholder="Branch summary"
                  value={branch.summary ?? ''}
                />
                <div className="flex gap-2">
                  <Input
                    disabled={disabled}
                    onChange={event => {
                      const branches = [...(rule.branches ?? [])]
                      branches[branchIndex] = { ...branch, assetUrl: event.target.value }
                      updateRule(index, { branches })
                    }}
                    placeholder="Asset URL"
                    value={branch.assetUrl ?? ''}
                  />
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      updateRule(index, {
                        branches: (rule.branches ?? []).filter((_, itemIndex) => itemIndex !== branchIndex)
                      })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <label className="flex items-center justify-between gap-3 text-xs font-medium">
            Channel follow-ups
            <Switch
              checked={Boolean(rule.followUpEnabled)}
              disabled={disabled}
              onCheckedChange={checked => updateRule(index, { followUpEnabled: checked })}
            />
          </label>
          {rule.followUpEnabled ? (
            <div className="grid gap-2">
              {(rule.followUps ?? []).map((followUp, followUpIndex) => (
                <div
                  className="grid gap-2 rounded-md border border-(--stroke-nous) p-2"
                  key={`follow-${followUpIndex}`}
                >
                  <Textarea
                    className="min-h-16"
                    disabled={disabled}
                    onChange={event => {
                      const followUps = [...(rule.followUps ?? [])]
                      followUps[followUpIndex] = { ...followUp, message: event.target.value }
                      updateRule(index, { followUps })
                    }}
                    placeholder="Follow-up message"
                    value={followUp.message}
                  />
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-medium">
                      Delay (minutes)
                      <Input
                        disabled={disabled}
                        min={1}
                        onChange={event => {
                          const followUps = [...(rule.followUps ?? [])]
                          followUps[followUpIndex] = { ...followUp, delayMinutes: Number(event.target.value) || 30 }
                          updateRule(index, { followUps })
                        }}
                        type="number"
                        value={followUp.delayMinutes ?? 30}
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-medium">
                      CTA URL
                      <Input
                        disabled={disabled}
                        onChange={event => {
                          const followUps = [...(rule.followUps ?? [])]
                          followUps[followUpIndex] = { ...followUp, ctaUrl: event.target.value }
                          updateRule(index, { followUps })
                        }}
                        value={followUp.ctaUrl ?? ''}
                      />
                    </label>
                  </div>
                  <label className="flex items-center justify-between gap-3 text-xs font-medium">
                    Send this message verbatim
                    <Switch
                      checked={Boolean(followUp.useCustomMessage)}
                      disabled={disabled}
                      onCheckedChange={checked => {
                        const followUps = [...(rule.followUps ?? [])]
                        followUps[followUpIndex] = { ...followUp, useCustomMessage: checked }
                        updateRule(index, { followUps })
                      }}
                    />
                  </label>
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      updateRule(index, {
                        followUps: (rule.followUps ?? []).filter((_, itemIndex) => itemIndex !== followUpIndex)
                      })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Remove follow-up
                  </Button>
                </div>
              ))}
              <Button
                disabled={disabled}
                onClick={() => updateRule(index, { followUps: [...(rule.followUps ?? []), emptyFollowUp()] })}
                size="sm"
                type="button"
                variant="outline"
              >
                Add follow-up
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
