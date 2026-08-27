export const AIML_PATH = '/aiml'
export const AIML_CHECKOUT_PATH = '/aiml/checkout'

export function formatNgn(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

export const AIML_PRODUCT = {
  name: 'AI Money Library',
  shortName: 'AIML',
  headline: 'Stop collecting AI tools. Start collecting revenue.',
  tagline: 'Playbooks, prompts, and agent recipes that turn AI into a system you can sell with.',
  description:
    'A digital library of income systems you can run with AI — offers, content, outreach, and ready-to-use agent recipes.',
  priceNgn: 17500,
  priceLabel: '₦17,500',
  billing: 'One-time purchase',
  format: 'Instant digital access',
} as const

export const AIML_ORDER_BUMP = {
  name: 'Offer Accelerator Pack',
  description: 'Bonus swipe files, launch checklist, and extra agent recipes to ship your first offer faster.',
  priceNgn: 7500,
  priceLabel: '₦7,500',
} as const

export const AIML_PAINS = [
  'You have a graveyard of ChatGPT chats and no offer in the market.',
  'You watch AI tutorials, then go back to doing the work by hand.',
  'You bought tools. You still do not have a repeatable way to get paid.',
] as const

export const AIML_STEPS = [
  {
    step: '01',
    title: 'Get instant access',
    body: 'Checkout once. The library unlocks immediately — no shipping, no call, no login maze.',
  },
  {
    step: '02',
    title: 'Pick one money system',
    body: 'Start with the offer, the content machine, or outreach. One playbook. One outcome.',
  },
  {
    step: '03',
    title: 'Run it, then reuse it',
    body: 'Copy the prompts, deploy the agent recipes, and keep the system. This edition is yours.',
  },
] as const

export const AIML_AUDIENCE = {
  for: [
    'Freelancers who want an offer, not another prompt pack to bookmark.',
    'Founders who need AI to produce pipeline, not slide decks.',
    'Operators who will actually run a playbook this week.',
  ],
  notFor: [
    'People looking for a get-rich-overnight crypto bot.',
    'Teams that need a live SaaS subscription (that is Verxio, separately).',
    'Anyone who will not ship an offer after they have the system.',
  ],
} as const

export const AIML_MODULES = [
  {
    title: 'Offer Engine',
    body: 'Positioning, packaging, and pricing templates so you sell an outcome, not a pile of prompts.',
    valueNgn: 102547,
  },
  {
    title: 'Content Machine',
    body: 'Repeatable AI workflows for posts, emails, and landing copy that point back to an offer.',
    valueNgn: 70832,
  },
  {
    title: 'Outreach Playbooks',
    body: 'Scripts and sequences for inbound and outbound — personalized at scale without sounding like spam.',
    valueNgn: 70832,
  },
  {
    title: 'Agent Recipes',
    body: 'Ready-to-run agent setups for research, follow-up, fulfillment, and reporting.',
    valueNgn: 102547,
  },
  {
    title: 'Prompt Packs',
    body: 'Battle-tested prompts for research, offers, sales pages, and customer conversations.',
    valueNgn: 49688,
  },
  {
    title: 'Delivery Kit',
    body: 'How to fulfill, onboard, and keep buyers coming back — without building a giant ops team.',
    valueNgn: 49688,
  },
] as const

export const AIML_STACK_TOTAL = AIML_MODULES.reduce((sum, item) => sum + item.valueNgn, 0)

export const AIML_INCLUDES = [
  'Full library of income playbooks',
  'Copy-and-run prompt packs',
  'Agent recipes you can deploy',
  'Offer and pricing templates',
  'Lifetime access to this edition',
] as const

export const AIML_FAQ = [
  {
    q: 'What is the AI Money Library?',
    a: 'A digital product: playbooks, prompt packs, and agent recipes for using AI to create and sell offers — not another chatbot tutorial.',
  },
  {
    q: 'How do I get access?',
    a: 'After checkout you receive instant digital access. No shipping, no subscription for this edition.',
  },
  {
    q: 'Who is it for?',
    a: 'Founders, freelancers, and operators who already use AI and want a revenue system — not more tools to babysit.',
  },
  {
    q: 'Is this a Verxio subscription?',
    a: 'No. This is a one-time digital product. Verxio the platform is separate; recipes here can be used with Verxio or on their own.',
  },
  {
    q: 'What format is it?',
    a: 'A downloadable library you can use immediately: playbooks, prompt packs, and agent recipes. Open it, pick a system, run it.',
  },
] as const
