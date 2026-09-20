export const AIML_PATH = '/aiml'
export const AIML_CHECKOUT_PATH = '/aiml/checkout'
export const AIML_THANK_YOU_PATH = '/aiml/thank-you'
export const AIML_META_PIXEL_ID = '749073419907960'
export const AIML_TELEGRAM_URL =
  process.env.NEXT_PUBLIC_AIML_TELEGRAM_URL?.replace(/\/$/, '') || 'https://t.me/+XZYq5OzQXXQ2NDM0'
export const AIML_SUPPORT_EMAIL = 'support@verxio.xyz'

export function formatNgn(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

export const AIML_PRODUCT = {
  name: 'AI Money Library',
  shortName: 'AIML',
  headline: "If You Don't Start Using AI to Make Money Now, You May Regret It Soon",
  headlineAccent: 'You May Regret It Soon',
  tagline:
    'Discover how smart Nigerians are using AI to create services, get customers and make money — even without being AI experts.',
  description:
    'Practical AI skills you can use to create useful work for yourself or other businesses, then turn those skills into services people will pay for.',
  ctaLabel: 'Get Access Now',
  skillCount: 120,
  fullSkillCount: 320,
  priceNgn: 17500,
  priceLabel: '₦17,500',
  comparePriceLabel: '₦50,000',
  billing: 'One-time payment. Lifetime access.',
  format: 'Instant access after payment',
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

export const AIML_PROOF = {
  title: "Look at what's possible:",
  results: [
    {
      amount: '₦120,000',
      label: 'For ONE AI-assisted service',
      src: '/aiml/testimonial-offer-120k.png',
      alt: 'Customer chat: The Offer Creation Skill helped me sell my first package for ₦120,000.',
    },
    {
      amount: '₦300,000/mo',
      label: "A client's monthly payment",
      src: '/aiml/testimonial-300k-month.png',
      alt: 'Customer chat: The AI Expert Skills helped me earn ₦300k per month from two clients.',
    },
    {
      amount: '₦200,000',
      label: 'From ONE business service',
      src: '/aiml/testimonial-femi-200k.png',
      alt: 'Customer chat: Femi from Ibadan closed a ₦200,000 setup fee plus monthly support.',
    },
  ],
  payment: {
    src: '/aiml/proof-blessing-email.png',
    alt: 'Email from Blessing Isiong: using the AI Expert Skill Library to set up an AI Bookkeeper for a POS business in Benin.',
  },
} as const

export const AIML_STORY = {
  ordinary:
    "And these aren't people sitting in some fancy office with years of tech experience. They are ordinary people who learned how to use AI to create things businesses and customers actually need.",
  because: 'Because right now…',
  needTitle: 'Businesses need help.',
  needLead: 'Lots of it.',
  needBody:
    'Content. Sales. Marketing. Research. Designs. Videos. Offers. Business planning. Customer service. And plenty more.',
  possible: 'And AI has made it possible to do many of these things faster and easier than before.',
  problemLead: "But here's the problem…",
  problem:
    "Knowing how to use ChatGPT or Claude doesn't automatically put money in your account. You need to know what to do with AI.",
  needToKnow: [
    'What to create.',
    'What services to offer.',
    'Who to offer them to.',
    'What to say.',
    'How to price your work.',
    'And how to turn what AI can do into something people will actually pay you for.',
  ],
  bridge: "That's what AI Money Library shows you.",
} as const

export const AIML_FROM_AI = {
  title: 'From AI to money.',
  paragraphs: [
    "You'll discover practical AI skills you can use to create useful work for yourself or other businesses.",
    "You'll learn the different things AI can help you do…\n\nhow to use the skills…\n\nhow to apply them to real business problems…\n\nand how to turn those skills into services people can pay you for.",
  ],
  testimonials: [
    {
      src: '/aiml/testimonial-amaka-100k.png',
      alt: 'Customer chat: Amaka used the AI Expert Skill Library to set up follow-up and reporting for a real estate company and was retained at ₦100,000 per month.',
    },
    {
      src: '/aiml/testimonial-david-400k.png',
      alt: 'Customer chat: David used the Competitor Analysis AI Skill to close a ₦400,000 marketing job.',
    },
  ],
} as const

export const AIML_REQUIREMENTS = {
  title: "You don't need:",
  avoid: [
    'A tech degree',
    'Years of experience',
    'Thousands of followers',
    'To be an AI expert',
    'Expensive software',
  ],
  need: 'You need a phone or computer, internet, the right AI tools… and the right skills to put AI to work.',
} as const

export const AIML_INCLUDES_BEFORE_VIDEO = [
  {
    title: 'The AI Money Skill Library',
    body: 'Discover practical AI skills you can use for content, sales, marketing, research, business, designs, videos, planning and more.',
  },
  {
    title: 'AI for business',
    body: 'Learn how to use AI to solve everyday business problems and get more done without doing everything manually.',
  },
  {
    title: 'AI service opportunities',
    body: 'Discover the different AI-powered services you can offer to businesses and individuals.',
  },
  {
    title: 'Ready-to-use AI skills',
    body: "Don't waste hours wondering what to type or how to structure your work. Use practical, ready-to-go skills and prompts to get started faster.",
  },
] as const

export const AIML_WALKTHROUGH = {
  quote: "Come inside. Let me show you exactly what you're getting.",
  videoSrc: '/aiml/how-to-use-expert-skills.mp4',
  videoTitle: 'AI Money Library walkthrough',
} as const

export const AIML_INCLUDES_AFTER_VIDEO = [
  {
    title: 'AI tools',
    body: 'Discover the AI tools you can use to create, research, write, design, plan and execute faster.',
  },
  {
    title: 'Money-making ideas',
    body: 'Discover practical ways to turn your AI skills into services, freelance work and business opportunities.',
  },
  {
    title: 'Business & sales skills',
    body: 'Learn AI-assisted skills for finding customers, creating offers, marketing and selling.',
  },
  {
    title: 'Private community + support',
    body: "You're not left alone after buying. You get access to a community where you can ask questions, share your work and learn with others.",
  },
  {
    title: 'Updates',
    body: 'AI is changing fast. Your library continues to grow as new tools, techniques and opportunities emerge.',
  },
] as const

export const AIML_PRICE = {
  lead: 'And you get all of this for…',
  billing: 'One-time payment. Lifetime access.',
  notes: ['No monthly subscription.', 'No complicated setup.', 'Just get access and start learning.'],
} as const

export const AIML_OPPORTUNITY = {
  title: 'The opportunity is already here.',
  paragraphs: [
    { text: 'People are already using AI.' },
    {
      text: 'Businesses are already looking for people who can help them create content, market their businesses, research, design, sell and get things done faster.',
    },
    { text: 'The tools are already available.' },
    { text: 'The question is…' },
    { text: 'will you learn how to actually use them?', emphasis: true },
    {
      text: "Because the people making money with AI aren't necessarily the people who know the most about technology.",
    },
    { text: "They're the people who know how to turn AI into something useful." },
    { text: 'Something they can use themselves.' },
    { text: 'Or something they can offer to someone who needs it.' },
  ],
  testimonial: {
    src: '/aiml/testimonial-offer-client-120k.png',
    alt: 'Customer chat: I used the Offer Creation Skill from the 120 AI Expert Skill Library to land a ₦120,000 client.',
  },
} as const

export const AIML_CLOSE = {
  title: 'Get access to AI Money Library now.',
  steps: ['Start learning.', 'Start creating.', 'Start using AI.', 'Start finding ways to make money with it.'],
  ctaHeading: 'Get the AI Money Library for ₦17,500',
  finePrint: 'Instant access after payment · One-time payment · Lifetime access',
  finalTitle: 'Stop hearing about what AI can do.',
  finalBody: 'Start learning what you can actually do with it.',
  finalCta: 'Get AI Money Library now',
} as const

export const AIML_THANK_YOU = {
  title: 'THANK YOU FOR YOUR PURCHASE',
  lead: "You're in. Here's exactly what happens next.",
  steps: [
    {
      number: '01',
      title: 'JOIN THE TELEGRAM',
      body: 'This is the first thing you must do. Join the community now so you do not miss updates, trainings, or support.',
      cta: 'JOIN THE TELEGRAM NOW',
      href: AIML_TELEGRAM_URL,
      external: true,
    },
    {
      number: '02',
      title: 'CHECK YOUR EMAIL',
      body: 'Open the email address you used to buy AI Money Library. Your access and files were sent there. Check spam or promotions if you do not see it.',
    },
    {
      number: '03',
      title: 'USE THE PRODUCT',
      body: 'Drag and drop the skills into ChatGPT, Claude, Gemini, or any AI agent. That is how you start using the library immediately.',
    },
    {
      number: '04',
      title: 'SIGN UP ON VERXIO',
      body: 'You can also sign up and use the Verxio operator platform to put these skills to work.',
      cta: 'SIGN UP ON VERXIO',
      href: '/signup',
      app: true,
    },
    {
      number: '05',
      title: 'NEED HELP?',
      body: 'Any issue? Contact support@verxio.xyz for support or any clarification.',
      cta: 'EMAIL SUPPORT',
      href: `mailto:${AIML_SUPPORT_EMAIL}`,
      external: true,
    },
  ],
} as const

export const AIML_GUARANTEE = {
  title: '100% Money-Back Guarantee',
  body: 'If you use the library, do your part, and can document that the product itself did not work, you can request your money back. The library is an AI skill toolkit, not a magic wand. Lack of results from unused skills or skipped work does not trigger the guarantee.',
  termsLabel: 'Read the full guarantee terms',
  termsHref: '/terms-of-service#money-back-guarantee',
  testimonial: {
    src: '/aiml/testimonial-bookkeeping-setup.png',
    alt: 'Customer chat: I used the AI Expert Skill to set up AI bookkeeping for my own business, and other business owners now pay me to set it up for them.',
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

export const AIML_PLACEHOLDERS = {
  beforeAfter: {
    videoUrl: 'https://youtu.be/2K5c9IT4VnI',
    videoId: '2K5c9IT4VnI',
    videoTitle: 'Before and after: generic AI versus expert-trained AI',
  },
} as const

export const AIML_DISCLAIMER = {
  facebook:
    'NOT FACEBOOK: This site is not a part of the Facebook™ website or Facebook Inc. Additionally, this site is NOT endorsed by Facebook™ in any way. FACEBOOK is a trademark of FACEBOOK, Inc.',
  results:
    'DISCLAIMER: Please understand results are not typical. Your results will vary and depend on many factors including but not limited to your background, experience, and work ethic. All business entails risk as well as taking regular and consistent effort and action.',
  guarantees:
    'Verxio can not and does not make any guarantees about your ability to get results or earn any money with our ideas, information, tools, or strategies.',
  legal:
    'Nothing on this page, any of our websites, or any of our content or curriculum is a promise or guarantee of results or future earnings, and we do not offer any legal, medical, tax or other professional advice. Any financial numbers referenced here, or on any of our sites, are illustrative of concepts only and should not be considered average earnings, exact earnings, or promises for actual or future performance. Use caution and always consult your accountant, lawyer or professional advisor before acting on this or any information related to a lifestyle change or your business or finances. You alone are responsible and accountable for your decisions, actions and results in life, and by your use of this site you agree not to attempt to hold us liable for your decisions, actions or results, at any time, under any circumstance.',
  facebookRepeat:
    'This site is not a part of the Facebook website or Facebook Inc. Additionally, this site is NOT endorsed by Facebook in any way. FACEBOOK is a trademark of FACEBOOK, Inc.',
} as const
