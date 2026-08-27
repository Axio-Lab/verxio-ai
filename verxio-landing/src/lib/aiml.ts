export const AIML_PATH = '/aiml'
export const AIML_CHECKOUT_PATH = '/aiml/checkout'

export const AIML_PRODUCT = {
  name: 'AI Money Library',
  shortName: 'AIML',
  tagline: 'Playbooks, prompts, and agent recipes that turn AI into revenue.',
  description:
    'A digital library of income systems you can run with AI — offers, content, outreach, and ready-to-use agent recipes.',
  priceUsd: 97,
  priceLabel: '$97',
  billing: 'One-time purchase',
  format: 'Instant digital access',
} as const

export const AIML_MODULES = [
  {
    title: 'Offer Engine',
    body: 'Positioning, packaging, and pricing templates so you sell an outcome, not a pile of prompts.',
  },
  {
    title: 'Content Machine',
    body: 'Repeatable AI workflows for posts, emails, and landing copy that point back to an offer.',
  },
  {
    title: 'Outreach Playbooks',
    body: 'Scripts and sequences for inbound and outbound — personalized at scale without sounding like spam.',
  },
  {
    title: 'Agent Recipes',
    body: 'Ready-to-run agent setups for research, follow-up, fulfillment, and reporting.',
  },
  {
    title: 'Prompt Packs',
    body: 'Battle-tested prompts for research, offers, sales pages, and customer conversations.',
  },
  {
    title: 'Delivery Kit',
    body: 'How to fulfill, onboard, and keep buyers coming back — without building a giant ops team.',
  },
] as const

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
] as const
