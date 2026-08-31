export const AIML_PATH = '/aiml'
export const AIML_CHECKOUT_PATH = '/aiml/checkout'

export function formatNgn(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

export const AIML_PRODUCT = {
  name: 'AI Money Library',
  shortName: 'AIML',
  headline: 'Make ChatGPT and Claude Work Like Experts, Then Get Paid for It',
  headlineAccent: 'Get Paid for It',
  tagline:
    'Get 120 ready-to-use AI skills for work people already pay for: customer research, adverts, sales pages, content, design and more. Use them to grow your own business, offer the work as a service, or start your own AI agency. No long course. No staff. Choose a skill, add your details and let the AI guide the work.',
  audience:
    'Made for Nigerian vendors, freelancers, creators and small business owners who want to use AI without becoming tech experts.',
  description:
    'Get 120 expert AI skills across 13 categories. Load them into ChatGPT or Claude. Keep them forever. One payment. No subscriptions.',
  ctaLabel: 'Get Instant Access Now',
  skillCount: 120,
  fullSkillCount: 320,
  priceNgn: 17500,
  priceLabel: '₦17,500',
  billing: 'One-time purchase',
  format: 'Instant digital access',
  checkoutUrl: 'https://paystack.shop/pay/l510mohlb6',
} as const

export const AIML_ORDER_BUMP = {
  name: '200 Advanced AI Skills',
  checkboxLabel: 'YES, Add 200 more Advanced AI Skills to My Order',
  valueLabel: '₦75,000 value',
  todayLabel: '+₦7,500',
  lead: 'You are already getting 120 expert skills today. But if you want to completely replace an expensive marketing team, add this upgrade. For just ₦7,500 extra, you unlock 200 more advanced skills. This brings your total library to 320 expert tools.',
  systemsIntro: 'This upgrade gives you the exact systems agencies use to charge premium retainers:',
  systems: [
    {
      title: 'Meta Ads Analyzer',
      body: 'Review your advert results, find weak areas and get clear suggestions for improving the campaign.',
    },
    {
      title: 'Competitor Analysis',
      body: 'Study how other businesses price, promote and sell, then find ways to make your offer stronger.',
    },
    {
      title: 'Deep Customer Research',
      body: 'Understand what buyers want, what problems they need solved and what matters before you pitch.',
    },
    {
      title: 'SEO and AEO Ranking',
      body: 'Put your business at the top of Google searches without paying an agency a monthly fee.',
    },
    {
      title: 'Graphic Design Director',
      body: 'Create professional ad creatives, product mockups, and social graphics without paying a designer or learning Photoshop.',
    },
    {
      title: 'Cold Email Closer',
      body: 'Write clear email sequences designed to get the attention of better-paying clients and encourage replies.',
    },
    {
      title: 'Sales Page Auditor',
      body: 'Find possible reasons people visit your website without buying, then improve the weak parts of the page.',
    },
  ],
  closer:
    'If you want to handle high-paying client work or scale your own business faster, check the box to add this to your order.',
  priceNgn: 7500,
  priceLabel: '₦7,500',
  checkoutUrl: 'https://paystack.shop/pay/hc-q1-9ey1',
} as const

export const AIML_REALITY = {
  title: 'If AI Has Disappointed You Before, You Are Not Alone',
  paragraphs: [
    'You may have opened ChatGPT, typed a question and received an answer that sounded robotic or useless. You changed the prompt, tried again and still did not get work you could use or sell.',
    'That does not mean you are bad at AI. Most people were shown how to ask simple questions. They were not given the instructions an expert uses to do a complete job.',
    'The good news is that Nigerian business owners already pay for this work every day: adverts, customer research, sales pages, social media content, designs and emails. With the right AI skill, you can do that work for your own business or offer it as a paid service.',
  ],
} as const

export const AIML_PROBLEM = {
  title: 'Why the Prompts You Tried Did Not Work',
  lead: 'Your AI is not the problem. It needs clear instructions for the exact job.',
  paragraphs: [
    'Maybe you copied prompts from social media, watched videos or bought another AI tool. The result was still too general because a short prompt does not contain the full process for research, adverts, sales or content.',
    'When the AI has to guess, you spend more time correcting bad work. You may still pay a writer, designer or agency, or lose a job you could have handled yourself.',
  ],
} as const

export const AIML_DIFFERENCE = {
  title: 'See What Changes When the AI Knows the Job',
  lead: 'Imagine a client asks you to write a Facebook advert. Here is the difference between a basic prompt and an AI Money Library skill.',
  beforeLabel: 'BEFORE (Regular ChatGPT)',
  beforeQuote:
    'Welcome to our shop! We offer the best products at the most affordable prices. Customer satisfaction is our priority. Buy now!',
  beforeResult: 'It sounds like every other advert. There is no clear reason to stop and buy.',
  afterLabel: 'AFTER (Using the Conversion Ad Copy Skill)',
  afterQuote:
    'Are rising supply costs reducing your profit? See three practical ways to spend less on your next order without reducing quality. Tap below to get the guide.',
  afterResult: 'It names a real problem, gives a clear benefit and tells the buyer what to do next.',
  closer: 'That is the difference between asking AI to guess and giving it a proven process to follow.',
} as const

export const AIML_BETTER_WAY = {
  title: 'The Simple Way to Get Better Work From AI',
  paragraphs: [
    'The AI Money Library gives you 120 expert AI skills like the one above. Each skill tells ChatGPT or Claude what questions to ask, what steps to follow and what a good result should contain.',
    'You do not need a six-week course or technical experience. Choose the job, paste the skill, answer a few questions and use the result.',
  ],
} as const

export const AIML_STEPS = [
  { step: '01', title: 'Copy the skill', body: 'Open the library and copy the expert skill you need.' },
  { step: '02', title: 'Paste and answer', body: 'Paste it into ChatGPT or Claude and answer the questions it asks.' },
  { step: '03', title: 'Use the result', body: 'Get work you can use in your business or deliver to a paying client.' },
] as const

export const AIML_CATEGORIES = {
  lead: 'You are not buying random prompts. You are getting 13 types of work your AI can help you do for your own business or for a paying client.',
  groups: [
    {
      title: 'Find people who will actually pay',
      body: 'Do customer research, find possible buyers and study competitors. Learn what people want, what they can pay and how other businesses sell.',
    },
    {
      title: 'Get them to click, reply, and buy',
      body: 'Create Facebook adverts, sales messages and cold emails. Use clear words that get attention and help people understand why they should buy.',
    },
    {
      title: 'Look like a real business, fast',
      body: 'Create content, social posts, brand messages and design ideas. Help a business look professional and get found on Google and AI search.',
    },
    {
      title: 'Catch bad work before a client sees it',
      body: 'Check AI writing before you send it. Find weak or robotic parts, improve the work and turn useful videos into clear notes.',
    },
  ],
} as const

export const AIML_PAYOFF = {
  title: 'Use It for Your Business or Sell the Service',
  lead: 'There are two simple ways to get value from this library:',
  items: [
    {
      title: '1. Keep your money.',
      body: 'Use the skills to write your adverts, research your customers and improve your sales pages instead of paying for every small job.',
    },
    {
      title: '2. Sell the service.',
      body: 'Offer customer research, adverts, content, sales pages or search ranking to vendors, shops and small businesses. Start with one service and grow from there.',
    },
  ],
} as const

export const AIML_PROOF = {
  title: 'Built From Real Business Work',
  body: 'This is not a random list of prompts. The system was built while working on Verxio and Okporoko Central, a Nigerian business that sells physical products. The skills are designed around real jobs businesses need, not AI theory.',
} as const

export const AIML_GUARANTEE = {
  title: '100% Money-Back Guarantee',
  body: 'Try the library without carrying all the risk. If it does not help you get better work from your AI, ask for your money back. No long form. No stress.',
} as const

export const AIML_CHOICE = {
  title: 'Start With One Skill and One Real Job',
  body: 'You already have access to ChatGPT or Claude. Give it a clear job, follow the steps and use the result. Start with your own business or choose one service to sell.',
} as const

export const AIML_OFFER = {
  title: 'AI Money Library Bundle',
  heading: 'Bundle Package',
  priceAnchor: 'Less than what you may pay someone to write one sales page.',
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
      body: 'Keep this edition of the skills and use them whenever you need them.',
    },
    {
      title: 'Zero Monthly Fees',
      body: 'One single payment. No hidden subscriptions.',
    },
  ],
  closer:
    'One useful advert, client job or business improvement can cover what you paid for the library.',
  bonusesHeading: 'Free Bonuses When You Get In Today',
  bonuses: [
    {
      label: 'Bonus 1',
      title: 'AI Money Weekend',
      valueLabel: '₦250,000 value',
      body: 'A weekly live coaching call where you learn how to make money with AI: new earning opportunities, real updates, and direct guidance, every week.',
    },
    {
      label: 'Bonus 2',
      title: 'Premium Access to Verxio',
      valueLabel: '₦100,000 value',
      body: 'Free access to Verxio, a full AI operator platform built to run business operations for you. Included at no extra cost.',
    },
    {
      label: 'Bonus 3',
      title: 'Access to the AI Money Community',
      valueLabel: null,
      body: "A private community where new trainings and new skills are dripped in regularly, so you're always working with the latest tools, not what worked six months ago.",
    },
    {
      label: 'Bonus 4',
      title: 'AI Business Audit',
      valueLabel: '₦100,000 value',
      body: 'We review your business and match you with an AI skill you can use to work toward your first ₦100,000.',
    },
    {
      label: 'Bonus 5',
      title: 'How to Get Your First 100 Customers',
      valueLabel: '₦50,000 value',
      body: 'A practical step by step framework for finding and winning your first 100 customers.',
    },
  ],
  bonusesTotal: '₦500,000+',
  bonusesCloser: 'yours free when you get the AI Money Library today.',
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
} as const
