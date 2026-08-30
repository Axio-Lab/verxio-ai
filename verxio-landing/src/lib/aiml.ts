export const AIML_PATH = '/aiml'
export const AIML_CHECKOUT_PATH = '/aiml/checkout'

export function formatNgn(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

export const AIML_PRODUCT = {
  name: 'AI Money Library',
  shortName: 'AIML',
  headline: 'Stop Trying to Learn AI. Just Train Your ChatGPT to Do the Work of 100 Experts.',
  tagline:
    'Get 100 plug-and-play AI skills across 13 business categories. Turn any AI into a specialist who finds customers, writes ads, and fixes sales pages so you can keep the money you would normally pay a professional.',
  description:
    'Get 120 expert AI skills across 13 categories. Load them into ChatGPT or Claude. Keep them forever. One payment. No subscriptions.',
  ctaLabel: 'Get Instant Access Now',
  skillCount: 120,
  fullSkillCount: 320,
  priceNgn: 17500,
  priceLabel: '₦17,500',
  billing: 'One-time purchase',
  format: 'Instant digital access',
} as const

export const AIML_ORDER_BUMP = {
  name: '200 Advanced AI Skills',
  checkboxLabel: 'YES, Add 200 Advanced AI Skills to My Order (+₦7,500)',
  lead: 'You are already getting 120 expert skills today. But if you want to completely replace an expensive marketing team, add this upgrade. For just ₦7,500 extra, you unlock 200 more advanced skills. This brings your total library to 320 expert tools.',
  systemsIntro: 'This upgrade gives you the exact systems agencies use to charge premium retainers:',
  systems: [
    {
      title: 'Meta Ads Analyzer',
      body: 'Stop burning money on bad ads. Let the AI find exactly what is wrong with your campaign and fix it.',
    },
    {
      title: 'Competitor Analysis',
      body: 'Spy on your rivals. Find out exactly how they price and sell so you can beat them.',
    },
    {
      title: 'Deep Customer Research',
      body: 'Know exactly what your buyers want to spend money on before you even pitch them.',
    },
    {
      title: 'SEO and AEO Ranking',
      body: 'Put your business at the top of Google searches without paying an agency a monthly fee.',
    },
  ],
  closer:
    'If you want to handle high-paying client work or scale your own business faster, check the box to add this to your order.',
  priceNgn: 7500,
  priceLabel: '₦7,500',
} as const

export const AIML_REALITY = {
  title: 'The Reality',
  paragraphs: [
    'Everyone is talking about making money with AI. But here is what actually happens. You open ChatGPT or Claude. You type a vague prompt. You get a generic answer that sounds like a robot. You fix it, get frustrated, and do it again the next day from zero.',
    'Meanwhile, the people actually making money are not typing prompts. They are using AI to deliver real work that business owners desperately need: ad copy, customer research, sales pages, video content, graphic designs, cold emails.',
    'Business owners are paying professionals thousands of Naira every day for this work. That money could be yours.',
  ],
} as const

export const AIML_PROBLEM = {
  title: 'The Problem',
  lead: 'Your AI is not the problem. It just was not trained to do the job.',
  paragraphs: [
    'ChatGPT does not know what a converting Facebook ad looks like. It does not know the exact questions to ask for customer research. It does not know how to build a cold email sequence that gets replies instead of silence.',
    'Every time you ask it to guess, you are losing money. And every time a business owner hires an agency because your AI could not prove it knew the job, you miss a payday.',
  ],
} as const

export const AIML_DIFFERENCE = {
  title: 'See The Difference: Regular AI vs. Expert Trained AI',
  lead: 'Let’s say a client pays you to write a Facebook Ad for their business. Here is what happens when you use regular AI versus the AI Money Library.',
  beforeLabel: 'BEFORE (Regular ChatGPT)',
  beforeQuote:
    'Welcome to our shop! We offer the best products at the most affordable prices. Customer satisfaction is our priority. Buy now!',
  beforeResult: 'Sounds robotic. Zero clicks. Wasted ad spend. Client fires you.',
  afterLabel: "AFTER (Using our 'Conversion Ad Copy' Skill)",
  afterQuote:
    'Stop overpaying for your supplies. Here is the exact system 500+ local businesses are using to cut costs by 30% this week without dropping quality. Click here to see the breakdown.',
  afterResult: 'Hooks the reader, builds curiosity, drives cheap clicks. Client pays you again.',
  closer: 'This is not just a minor improvement. It is the difference between getting ignored and getting paid.',
} as const

export const AIML_BETTER_WAY = {
  title: 'The Better Way',
  paragraphs: [
    'The AI Money Library gives you 100 expert-built skills just like the one above. You drop them straight into your AI. It immediately stops guessing and starts working like a professional who has done the job a thousand times.',
    'No 6-week courses. No expensive mentorship programs. No waiting to learn AI. You load the skill, and the work gets done.',
  ],
} as const

export const AIML_STEPS = [
  { step: '01', title: 'Copy the skill', body: 'Open the library and copy the expert skill you need.' },
  { step: '02', title: 'Paste into ChatGPT', body: 'Drop it into ChatGPT or Claude. No setup course required.' },
  { step: '03', title: 'Get expert output', body: 'Watch the specialist-level work generate instantly.' },
] as const

export const AIML_CATEGORIES = {
  lead: 'You are not buying folders of prompts. You are buying 13 jobs your AI can do today — for your own business, or as a service you charge for.',
  groups: [
    {
      title: 'Find people who will actually pay',
      body: 'Research, lead generation, and competitor intel. Your AI asks the right questions, finds buyers with money, and shows you how others price — so you stop guessing what to sell.',
    },
    {
      title: 'Get them to click, reply, and buy',
      body: 'Ads, sales pitches, and cold emails. Your AI writes Facebook ads that hook, pitches that close, and outreach that gets replies instead of silence. This is the work agencies charge thousands of Naira for.',
    },
    {
      title: 'Look like a real business, fast',
      body: 'Content, social posts, brand voice, design, and SEO. Your AI writes like a person, plans what to post, makes simple graphics, and helps a business show up on Google — even if you have never hired a designer.',
    },
    {
      title: 'Catch bad work before a client sees it',
      body: 'Quality checks and research tools. Scan robotic AI writing before it goes out, and turn any YouTube video into notes you can use the same day.',
    },
  ],
} as const

export const AIML_PAYOFF = {
  title: 'The Payoff',
  lead: 'Two direct ways this library makes you money:',
  items: [
    {
      title: '1. Keep your money.',
      body: 'Stop hiring professionals for work your AI can now handle. Write your own ads, research your own market, and build your own funnels.',
    },
    {
      title: '2. Sell the service.',
      body: 'Every skill in this library is a service another business owner will pay you for. You do not need five years of experience when the AI skill already has it.',
    },
  ],
} as const

export const AIML_PROOF = {
  title: 'The Proof',
  body: 'This is not a random PDF of prompts. This is the exact skill system behind Verxio, an AI operating system generating real revenue. It is the same system used to scale Okporoko Central, a real Nigerian business moving physical products every day.',
} as const

export const AIML_GUARANTEE = {
  title: 'The Guarantee',
  body: 'If the library does not turn your AI into a working expert, ask for your money back. No long forms. No hassle.',
} as const

export const AIML_CHOICE = {
  title: 'The Choice',
  body: 'You do not need to hire an expert. You just need to train the AI you already have. Get the library and start doing real work today.',
} as const

export const AIML_OFFER = {
  title: 'The Offer',
  heading: 'Main Package',
  priceAnchor: 'Less than what you would pay a beginner copywriter for one bad sales page.',
  intro: 'Here is exactly what you get the second you check out:',
  items: [
    {
      title: '120 Expert AI Skills',
      body: 'Spread across 13 business categories.',
    },
    {
      title: 'Plug-and-Play Setup',
      body: 'Load them directly into ChatGPT or Claude in seconds.',
    },
    {
      title: 'Lifetime Access',
      body: 'Keep the exact prompts that print money forever.',
    },
    {
      title: 'Zero Monthly Fees',
      body: 'One single payment. No hidden subscriptions.',
    },
  ],
  closer:
    'This library pays for itself the very first time you use it to write an ad, close a deal, or avoid hiring an agency.',
} as const

export const AIML_PLACEHOLDERS = {
  hero: {
    label: 'Hero image',
    idea: 'A high-quality digital product mockup (a bundle box, a glowing folder, or a neat grid showing the 13 categories). It should look heavy, valuable, and instantly downloadable.',
  },
  beforeAfter: {
    label: 'Before and after visual',
    idea: 'A clean, side-by-side graphic. Left side (grey/dull): The boring ChatGPT response. Right side (bright/green): The punchy response formatted like a real high-performing Facebook Ad.',
  },
  howItWorks: {
    label: 'How it works',
    idea: 'A quick 3-step visual or GIF. 1. Copy the skill. 2. Paste into ChatGPT. 3. Watch the expert output generate instantly.',
  },
  testimonial1: {
    label: 'Testimonial 1',
    idea: 'A screenshot of a WhatsApp message or a tweet from a beta tester. E.g., “I used the Ad Copy skill for my fashion brand and made 3 sales today without hiring a copywriter! This library is crazy.”',
  },
  caseStudy: {
    label: 'Case study visual',
    idea: "A screenshot of Okporoko Central's storefront, a successful ad, or a dashboard showing real business activity to prove this is street-tested, not just theory.",
  },
  testimonial2: {
    label: 'Testimonial 2',
    idea: 'Another strong review from a Nigerian business owner or freelancer praising the practicality and time-saving nature of the skills.',
  },
  guarantee: {
    label: 'Guarantee badge',
    idea: 'A clean, trustworthy 100% Money-Back Guarantee badge.',
  },
} as const
