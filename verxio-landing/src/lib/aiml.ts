export const AIML_PATH = '/aiml'
export const AIML_CHECKOUT_PATH = '/aiml/checkout'

export function formatNgn(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

export const AIML_PRODUCT = {
  name: 'AI Money Library',
  shortName: 'AIML',
  headline: 'How to Start Your AI Agency With ChatGPT and Claude as Experts, and Make More Money with AI',
  headlineAccent: 'Make More Money with AI',
  tagline:
    'Ready-to-use AI expert skills to deliver products and services people already pay for. Choose a service and let ChatGPT or Claude guide the work.',
  description:
    'Get 120 expert AI skills for starting an AI agency with ChatGPT or Claude. Choose a service, deliver useful work and build from there.',
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
  title: 'You Do Not Need to Be an AI Expert to Start',
  paragraphs: [
    'Businesses need customer research, adverts, sales pages, content, designs and help getting found online. They already pay people and agencies to do this work.',
    'You may want to offer these services but feel you do not have enough experience. Or you may have tried ChatGPT and received answers that sounded robotic, vague or impossible to sell.',
    'That does not mean an AI agency is beyond you. It means ChatGPT or Claude needs the right instructions for each job. Give the AI an expert process to follow and you can focus on finding clients, understanding their needs and delivering useful work.',
  ],
} as const

export const AIML_PROBLEM = {
  title: 'Why Most People Never Turn AI Into Income',
  lead: 'They keep learning about AI but never build a service they can confidently offer.',
  paragraphs: [
    'They watch more videos, save random prompts and test new tools. But when a real business asks for customer research, an advert or a sales page, those short prompts do not contain the full process needed to do the job well.',
    'The AI has to guess. The result needs too much correction, so they do not trust the work enough to charge for it. More courses do not solve this. A clear service and a repeatable system do.',
  ],
} as const

export const AIML_DIFFERENCE = {
  title: 'See What Changes When Your AI Has an Expert Process',
  lead: 'Imagine the first client for your AI agency asks for a Facebook advert. Here is the difference between a basic prompt and an AI Money Library skill.',
  beforeLabel: 'BEFORE (Regular ChatGPT)',
  beforeQuote:
    'Welcome to our shop! We offer the best products at the most affordable prices. Customer satisfaction is our priority. Buy now!',
  beforeResult: 'It sounds like every other advert. There is no clear reason to stop and buy.',
  afterLabel: 'AFTER (Using the Conversion Ad Copy Skill)',
  afterQuote:
    'Are rising supply costs reducing your profit? See three practical ways to spend less on your next order without reducing quality. Tap below to get the guide.',
  afterResult: 'It names a real problem, gives a clear benefit and tells the buyer what to do next.',
  closer:
    'Your client does not pay for a prompt. The client pays for a useful result. The expert process helps you produce that result with more structure and confidence.',
} as const

export const AIML_BETTER_WAY = {
  title: 'Your AI Agency Can Start With One Service',
  paragraphs: [
    'You do not need an office, employees or ten services on your first day. Start with one problem a business already wants solved, such as customer research, adverts, content or sales pages.',
    'The AI Money Library gives you 120 expert AI skills across 13 categories. Each skill tells ChatGPT or Claude what questions to ask, what steps to follow and what the finished work should contain.',
  ],
} as const

export const AIML_STEPS = [
  {
    step: '01',
    title: 'Choose a service',
    body: 'Pick one useful job you can offer to a clear type of business.',
  },
  {
    step: '02',
    title: 'Run the expert skill',
    body: 'Add the client’s details and let ChatGPT or Claude guide you through the work.',
  },
  {
    step: '03',
    title: 'Deliver the result',
    body: 'Review the output, make it fit the client and deliver work they can use.',
  },
] as const

export const AIML_CATEGORIES = {
  lead: 'You are not buying random prompts. You are getting practical systems for services that businesses understand and already pay for.',
  groups: [
    {
      title: 'Research and business strategy',
      body: 'Help clients understand their customers, study competitors, improve offers and find better opportunities.',
    },
    {
      title: 'Advertising and sales',
      body: 'Create adverts, sales messages, email campaigns and sales pages that communicate a clear reason to buy.',
    },
    {
      title: 'Content and creative work',
      body: 'Plan content, write social posts, shape a brand voice and create ideas for graphics and product campaigns.',
    },
    {
      title: 'Search visibility and quality',
      body: 'Help businesses get found on Google and AI search, then review the work before it reaches the client.',
    },
  ],
} as const

export const AIML_PAYOFF = {
  title: 'Start Small, Then Grow Your AI Agency',
  lead: 'You do not need to build everything at once. Grow in two practical stages:',
  items: [
    {
      title: '1. Win one clear job.',
      body: 'Choose one service, practise the workflow and offer it to businesses that already need that result.',
    },
    {
      title: '2. Add more services.',
      body: 'After you can deliver one job confidently, use the other skills to serve the same client or reach new types of businesses.',
    },
  ],
} as const

export const AIML_GUARANTEE = {
  title: '100% Money-Back Guarantee',
  body: 'Explore the library and try the skills without carrying all the risk. If they do not help you turn ChatGPT or Claude into a more useful partner for client work, ask for your money back. No long form. No stress.',
} as const

export const AIML_CHOICE = {
  title: 'You Do Not Need a Team to Start',
  body: 'You need one service, one business problem and one expert process to follow. Choose your first service, use ChatGPT or Claude to do the work and build your AI agency one client at a time.',
} as const

export const AIML_OFFER = {
  title: 'AI Money Library Bundle',
  heading: 'Bundle Package',
  comparePriceLabel: '₦50,000',
  priceAnchor: 'Start with the tools for your first service without paying for another long course.',
  intro: 'Here is what you get to help you start and grow your AI agency:',
  items: [
    {
      title: '120 Expert AI Skills',
      body: 'Practical systems for services businesses already pay for.',
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
    'You do not have to master all 120 skills before you begin. Start with the one that helps you deliver your first useful service.',
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
    idea: 'A product mockup showing the AI Money Library turning ChatGPT and Claude into an expert team for a small AI agency.',
  },
  beforeAfter: {
    label: 'Before and after visual',
    idea: 'A side-by-side graphic showing a generic AI answer beside a structured client-ready advert created with an expert skill.',
  },
  howItWorks: {
    label: 'How it works',
    idea: 'A three-step visual: choose a service, run the expert skill, then review and deliver the client result.',
  },
} as const

export const AIML_TESTIMONIALS = [
  {
    src: '/aiml/testimonial-slides.png',
    alt: 'Customer chat: I designed the slides for my master class with Verxio.',
  },
  {
    src: '/aiml/testimonial-mind-blowing.png',
    alt: 'Customer chat: This is mind-blowing.',
  },
  {
    src: '/aiml/testimonial-business-owners.png',
    alt: 'Customer chat: I have tried it and it is working perfectly. It is a tool built for business owners.',
  },
  {
    src: '/aiml/testimonial-working-perfectly.png',
    alt: 'Customer chat: Thanks a lot. I have tested it and it is working perfectly.',
  },
] as const
