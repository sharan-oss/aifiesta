export const CTA = 'Get AIFiesta';
export const CTA_HREF = 'https://payments.cashfree.com/forms/am-ads-yearly-basic-plan';

// Reported to Meta with AddToCart and Purchase.
export const PLAN_VALUE = 7999;
export const PLAN_CURRENCY = 'INR';

export const models = [
  'ChatGPT', 'Perplexity', 'Qwen', 'Claude', 'Grok', 'Mistral', 'Gemini', 'DeepSeek', 'Kimi', 'Kling',
].map((name) => ({ name, icon: `/logos/strip-${name.toLowerCase()}.png` }));

export const benefits = [
  'Priced for India. Pay in rupees, no international card needed.',
  'One login, every top AI. ChatGPT, Claude, Gemini and 100+ more, side by side.',
  'Create anything. Images, videos, presentations and websites, all from one prompt box.',
  'Backed by Dhruv Rathee, an entrepreneur and digital content creator.',
];

export const features = [
  { n: '01', isNew: true, title: ['Generate images in', 'seconds'], body: 'Create social media posts, thumbnails, photos and more.', img: 'feature-images.png', alt: 'Image Studio prompt screen' },
  { n: '02', isNew: true, title: ['Create scroll-stopping', 'videos'], body: 'From idea to video in minutes, using top video generation models.', img: 'feature-videos.png', alt: 'Video generation screen' },
  { n: '03', isNew: false, title: ['Compare all AIs at once'], body: 'Ask the same question to all AIs at once. No more juggling between tabs.', img: 'feature-compare.png', alt: 'Side-by-side AI comparison' },
  { n: '04', isNew: true, title: ['Build websites with a', 'single prompt'], body: 'Create fully-functioning websites and landing pages without coding.', img: 'feature-websites.png', alt: 'Website builder screen' },
  { n: '05', isNew: true, title: ['Make impressive', 'presentations'], body: 'Choose from existing templates or explain your idea.', img: 'feature-presentations.png', alt: 'Presentation builder screen' },
  { n: '06', isNew: false, title: ['Talk to an Expert'], body: 'Career, finances, fitness, health - get your queries answered instantly.', img: 'feature-expert.png', alt: 'Expert chat selection' },
  { n: '07', isNew: false, title: ['Skip hours of research'], body: 'AI does the digging and the comparing. You just get the answers, fully cited.', img: 'feature-research.png', alt: 'Deep research screen' },
];

export const plan = {
  name: 'AI Fiesta Plus',
  save: 'Save ₹3,989',
  price: '₹7,999',
  was: '₹11,988',
  offer: 'Limited time offer',
  per: '/yr',
  monthly: 'Just ₹667/month, billed yearly',
  rows: [
    ['Tokens / month', '3M'],
    ['Images', 'Up to 350'],
    ['Videos', 'Up to 1'],
    ['Websites', 'Up to 5'],
    ['Slides', 'Up to 40'],
    ['Deep research runs', 'Up to 20'],
  ],
  note: 'All unused tokens roll over to next month. They never expire.',
};

export const pay = {
  tools: [
    { name: 'ChatGPT', icon: '/logos/strip-chatgpt.png', cost: '₹23,400' },
    { name: 'Claude', icon: '/logos/strip-claude.png', cost: '₹19,200' },
    { name: 'Gemini', icon: '/logos/strip-gemini.png', cost: '₹23,400' },
  ],
  total: '₹66,000',
  saving: 'With AI Fiesta Plus you save ₹58,001 a year',
};

export const testimonials = [
  { name: 'Saurabh Goswami', role: 'Graphic Designer', img: 'avatar-saurabh.png', text: 'I frequently use AI Fiesta for presentations, statistical analysis, image generation, editing, and day-to-day queries. The automatic prompt enhancement is especially useful.' },
  { name: 'Samir', role: 'Performance Marketer', img: 'avatar-samir.png', text: 'You get ChatGPT, Gemini, Perplexity, and many more AI tools in one place. Getting answers from different AIs at the same time is very helpful for comparing.' },
  { name: 'inner_ prem', role: 'Web Developer', img: 'avatar-prem.png', text: 'Having multiple AI models in one place saves a lot of time and makes it easy to compare responses. The Prompt Enhancer and Prompt Book are my favorite features.' },
  { name: 'Simi', role: 'Copywriter', img: 'avatar-simi.png', text: 'I have been using this app especially for my exams. It explains complex topics in very simple words and helps with everything from academics to everyday decisions.' },
];

// Answers after the first are taken from subscriptionplans.aifiesta.ai/single-subscription-plan-t2.
export const faqs = [
  { q: 'How is AI Fiesta different from subscribing to each AI separately?', a: 'AI Fiesta brings together Grok 4, ChatGPT 5, Gemini 2.5 Pro, DeepSeek, Claude Sonnet 4, Perplexity Sonar Pro, Kimi K2, Qwen 3 Max, Mistral, and many more in one place.' },
  { q: 'Can I choose which AI models to use?', a: 'Yes. You can toggle AI models on or off at any time during your chat and turn them back on later without losing your chat history.' },
  { q: 'Do I get unlimited messages?', a: 'You get 3,000,000 tokens per month. Each token is approximately ¾ of a word. For most users this is far more than needed - the average usage is around 200,000 tokens per month. Standard models consume tokens at 1x rate whereas Premium models consume tokens at 4x rate.' },
  { q: 'What happens if I run out of tokens?', a: "3 million tokens is a very large allowance and 99% of users never come close to exhausting it. You'll see warnings before hitting zero. If you reach the limit, reach out to support to get more tokens on a paid basis." },
  { q: 'Do you offer refunds?', a: 'No. All payments are non-refundable regardless of usage. You may cancel any time to stop future billing.' },
  { q: 'How can I manage or cancel my subscription?', a: 'Log in to AI Fiesta, go to Settings, and select your subscription management option.' },
  { q: 'Where can I access the Community and the Promptbook?', a: 'You can log in at community.aifiesta.ai using your registered email. This feature is only available to paid users.' },
  { q: 'Can I use AI Fiesta on my phone?', a: 'Yes. AI Fiesta is available on mobile browsers at chat.aifiesta.ai or as a dedicated Android and iOS app.' },
  { q: 'Will I get free upgrades when new AI versions are released?', a: 'Yes. If ChatGPT releases Model 6 or another AI provider launches a higher version, you will get access at no extra cost.' },
  { q: 'Who owns AI Fiesta?', a: 'AI Fiesta is an all-in-one AI subscription platform owned by Fiesta Labs Inc. Fiesta Labs Inc is owned by Dhruv Rathee, an entrepreneur and digital content creator.' },
];
