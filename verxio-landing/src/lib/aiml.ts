export const AIML_PATH = '/aiml'
export const AIML_CHECKOUT_PATH = '/aiml/checkout'

export function formatNgn(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

export const AIML_PRODUCT = {
  name: 'AI Money Library',
  shortName: 'AIML',
  headline: 'How to Use AI in Your Business to Get More Customers, Increase Sales and Make More Money',
  headlineAccent: 'Get More Customers, Increase Sales and Make More Money',
  tagline:
    'The AI Money Library gives you 120 ready-to-use skills for getting customers, improving offers, bookkeeping, data entry, content, designs, videos and more. Use them in your business or sell the finished work as a service.',
  description:
    'Use 120 expert AI skills to grow your business or offer content, design, bookkeeping, data entry and other paid services to businesses.',
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
  lead: 'You are already getting 120 expert skills. Add this upgrade if you want more advanced systems for growing your own business or handling bigger jobs for clients. For ₦7,500 extra, you unlock 200 more skills and bring your total library to 320.',
  systemsIntro: 'The upgrade adds systems for work such as:',
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
      body: 'Improve how your business appears in Google and AI search results without paying an agency a monthly fee.',
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
    'If you want more ways to improve your business or offer paid services, check the box to add this to your order.',
  priceNgn: 7500,
  priceLabel: '₦7,500',
  checkoutUrl: 'https://paystack.shop/pay/hc-q1-9ey1',
} as const

export const AIML_REALITY = {
  title: 'Your Business Already Has Work That Must Get Done',
  paragraphs: [
    'Every day, shop owners, traders, wholesalers, food vendors, POS agents, salons and service businesses look for customers, answer enquiries, record sales, track expenses and decide what to sell next.',
    'Many already use notebooks, WhatsApp, spreadsheets, calculators and memory. Those methods are familiar and useful. The problem starts when records go missing, follow-ups are forgotten, offers are unclear or important work takes too long.',
    'The AI Money Library helps you improve one job at a time. You can use a skill in your own business, or do the same work for another business and charge for the result.',
  ],
} as const

export const AIML_PROBLEM = {
  title: 'A Short Prompt Is Not a Working Business System',
  lead: 'ChatGPT can write an answer. It still needs the right process to produce work a business can use.',
  paragraphs: [
    'A one-line prompt leaves too much for the AI to guess. It may give you a generic advert, a weak offer or a report that misses the details that matter.',
    'An expert skill gives ChatGPT or Claude a clear job, the questions to ask and the steps to follow. You spend less time explaining from scratch and get a stronger first draft to review.',
  ],
} as const

export const AIML_DIFFERENCE = {
  title: 'See the Difference a Clear Process Makes',
  lead: 'Imagine you need a Facebook advert for your own business, or a customer pays you to write one. Here is the difference.',
  beforeLabel: 'BEFORE (Regular ChatGPT)',
  beforeQuote:
    'Welcome to our shop! We offer the best products at the most affordable prices. Customer satisfaction is our priority. Buy now!',
  beforeResult: 'It sounds like every other advert. There is no clear reason to stop and buy.',
  afterLabel: 'AFTER (Using the Conversion Ad Copy Skill)',
  afterQuote:
    'Are rising supply costs reducing your profit? See three practical ways to spend less on your next order without reducing quality. Tap below to get the guide.',
  afterResult: 'It names a real problem, gives a clear benefit and tells the buyer what to do next.',
  closer:
    'The value is not the prompt. The value is useful work: an advert that is clearer, a record that is organised or an offer customers can understand.',
} as const

export const AIML_BETTER_WAY = {
  title: 'Use the Skills in Your Business or Sell the Work',
  paragraphs: [
    'You do not need to choose between improving your own business and earning from other businesses. The same skill can help you do both.',
    'Start with the problem closest to you. Use a skill to improve your own work, or take that result to a shop owner, trader or service business that needs help.',
  ],
} as const

export const AIML_USE_PATHS = [
  {
    title: 'Use it in your own business',
    body: 'Create better offers, write adverts, follow up with customers, organise records, handle routine bookkeeping, enter data, plan content and create designs or videos.',
    result: 'You save time, reduce avoidable mistakes and do more of the work that can bring in or protect money.',
  },
  {
    title: 'Offer it as a paid service',
    body: 'Help another business with customer research, adverts, content, designs, videos, offer design, record keeping, data entry or other work from the library.',
    result: 'You agree on the job, use the right skill, review the work and get paid for the finished result.',
  },
] as const

export const AIML_STEPS = [
  {
    step: '01',
    title: 'Choose one business problem',
    body: 'Start with a real job: getting customers, improving an offer, organising records or completing work for a client.',
  },
  {
    step: '02',
    title: 'Open the matching skill',
    body: 'Add the business details and let ChatGPT or Claude ask questions and work through the job.',
  },
  {
    step: '03',
    title: 'Review and use the work',
    body: 'Check the output, correct the details, then use it in your business or deliver it to the customer who hired you.',
  },
] as const

export const AIML_CATEGORIES = {
  title: 'What You Can Do With the Expert AI Skills',
  lead: 'These are not random prompts. They are step-by-step systems for work that helps a business sell, stay organised and make better decisions.',
  groups: [
    {
      title: 'Get more customers',
      body: 'Plan adverts, sales messages, follow-up messages, social posts and simple campaigns that give people a clear reason to respond.',
    },
    {
      title: 'Build a stronger offer',
      body: 'Understand what customers want, study competing businesses, improve what you sell and explain why it is worth paying for.',
    },
    {
      title: 'Keep better business records',
      body: 'Organise sales, expenses, customer details, routine bookkeeping and data entry so important information is easier to find and use.',
    },
    {
      title: 'Create content, designs and videos',
      body: 'Plan posts, write scripts, prepare design ideas and create video content for your business or for a paying client.',
    },
    {
      title: 'Understand customers and competitors',
      body: 'Study what customers want, compare other businesses and turn what you learn into clear ideas you can use.',
    },
    {
      title: 'Prepare and deliver client work',
      body: 'Organise information, prepare reports and check finished work before you use it or send it to a paying client.',
    },
  ],
} as const

export const AIML_PAYOFF = {
  title: 'Start With One Useful Result',
  lead: 'You do not need to learn all 120 skills before you begin. Pick one job you understand and follow this path:',
  items: [
    {
      title: '1. Solve a problem close to you.',
      body: 'Use a skill for your own business, or help a business you already know. This gives you a real result to review.',
    },
    {
      title: '2. Repeat what works.',
      body: 'Keep using the skill in your business, offer the same job to more businesses or add another skill when there is a clear need.',
    },
  ],
} as const

export const AIML_GUARANTEE = {
  title: '100% Money-Back Guarantee',
  body: 'Explore the library and try the skills. If they do not help you use ChatGPT or Claude for useful business work, ask for your money back. No long form. No stress.',
} as const

export const AIML_CHOICE = {
  title: 'You Do Not Need a Team or Technical Background',
  body: 'You need one business problem and the right process. Choose a skill, add the details and review the work. Use the result yourself or get paid to deliver it to another business.',
} as const

export const AIML_OFFER = {
  title: 'AI Money Library Bundle',
  heading: 'Bundle Package',
  comparePriceLabel: '₦50,000',
  priceAnchor: 'Get practical systems for business work without paying for another long course.',
  intro: 'Here is what you get to improve your business or offer useful services to others:',
  items: [
    {
      title: '120 Expert AI Skills',
      body: 'Practical systems for sales, offers, research, records, content, designs, videos, planning and other business work.',
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
    'You do not have to master all 120 skills. Start with one job that can help your business or solve a problem another business will pay you to handle.',
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
    idea: 'A product mockup showing 120 expert AI skills for running your business better or handling paid work for other businesses.',
  },
  beforeAfter: {
    label: 'Before and after visual',
    idea: 'A side-by-side graphic showing a generic AI answer beside a structured client-ready advert created with an expert skill.',
    videoUrl: 'https://youtu.be/2K5c9IT4VnI',
    videoId: '2K5c9IT4VnI',
    videoTitle: 'Before and after: generic AI versus expert-trained AI',
  },
  howItWorks: {
    label: 'How it works',
    idea: 'A three-step visual: choose a service, run the expert skill, then review and deliver the client result.',
    videoSrc: '/aiml/how-to-use-expert-skills.mp4',
    posterSrc: '/aiml/how-to-use-expert-skills.png',
    videoTitle: 'How to use the plug-and-use expert AI skills',
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
