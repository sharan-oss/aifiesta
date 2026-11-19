export const CTA = 'Get AIFiesta';
export const CTA_HREF = 'https://payments.cashfree.com/forms/am-ads-yearly-basic-plan-offer';
// The Google Ads LP (/basic-plan-ga) checks out on its own Cashfree form.
export const CTA_HREF_GA = 'https://payments.cashfree.com/forms/am-yearly-basic-plan-ga-offer';
// The Meta LP (/basic-plan-v2-fb) checks out on its own Cashfree form.
export const CTA_HREF_META = 'https://payments.cashfree.com/forms/am-yearly-basic-plan-meta-offer';
// Any Cashfree form link counts as checkout (AddToCart, ad params passed through).
export const CHECKOUT_PREFIX = 'https://payments.cashfree.com/forms/';
// Every CTA except the pricing card scrolls here first, so visitors see the plan before paying.
export const PRICING_HREF = '#pricing';

export const META_PIXEL_ID = '1636798967975428';
export const GOOGLE_ADS_ID = 'AW-18532749665';
// Google Ads "Purchase" conversion action (send_to), fired on /thank-you-ga.
export const GOOGLE_ADS_PURCHASE = 'AW-18532749665/x5cyCP2vg6cdEOGijYVF';

// Reported to Meta with AddToCart and Purchase, and to Google Ads with Purchase.
export const PLAN_VALUE = 7999;
export const PLAN_CURRENCY = 'INR';

export const models = [
  'ChatGPT', 'Perplexity', 'Qwen', 'Claude', 'Grok', 'Mistral', 'Gemini', 'DeepSeek', 'Kimi', 'Kling',
].map((name) => ({ name, icon: `/logos/strip-${name.toLowerCase()}.png` }));

export const benefits = [
  'Priced for India. Pay in rupees, no international card needed.',
  'Backed by Dhruv Rathee, an entrepreneur and digital content creator.',
  'Made by an all-Indian team.',
];

export const features = [
  { n: '01', isNew: false, title: ['Compare all AIs at once'], body: 'Ask the same question to all AIs at once. No more juggling between tabs.', img: 'feature-compare.webp', alt: 'Side-by-side AI comparison', video: 'compare-mode.mp4' },
  { n: '02', isNew: true, title: ['Generate images in', 'seconds'], body: 'Create social media posts, thumbnails, photos and more.', img: 'feature-images.webp', alt: 'Image Studio prompt screen', video: 'image-studio.mp4' },
  { n: '03', isNew: true, title: ['Create scroll-stopping', 'videos'], body: 'From idea to video in minutes, using top video generation models.', img: 'feature-videos.webp', alt: 'Video generation screen', video: 'video-studio.mp4' },
  { n: '04', isNew: true, title: ['Build websites with a', 'single prompt'], body: 'Create fully-functioning websites and landing pages without coding.', img: 'feature-websites.webp', alt: 'Website builder screen', video: 'website-builder.mp4' },
  { n: '05', isNew: true, title: ['Make impressive', 'presentations'], body: 'Choose from existing templates or explain your idea.', img: 'feature-presentations.webp', alt: 'Presentation builder screen', video: 'presentations.mp4' },
  { n: '06', isNew: false, title: ['Talk to an Expert'], body: 'Career, finances, fitness, health - get your queries answered instantly.', img: 'feature-expert.webp', alt: 'Expert chat selection' },
  { n: '07', isNew: false, title: ['Skip hours of research'], body: 'AI does the digging and the comparing. You just get the answers, fully cited.', img: 'feature-research.webp', alt: 'Deep research screen' },
];

export const plan = {
  name: 'AI Fiesta Basic',
  save: 'Save ₹3,989',
  price: '₹7,999',
  was: '₹11,988',
  offer: 'Limited time offer',
  per: '/yr',
  monthly: 'Just ₹667/month, billed yearly',
  note: 'All unused tokens roll over to next month. They never expire.',
};

// 4x offer on the yearly plan, copied from anniversary.aifiesta.ai's yearly card.
// Rows: label, usual monthly amount, offer amount, icon key, optional info note.
export const offer = {
  multiple: '4x',
  rows: [
    ['Images', '300', '1200', 'image'],
    ['Videos', '30', '120', 'video', 'Numbers may vary based on models & settings'],
    ['Slides', '300', '1200', 'slides'],
    ['Websites', '5', '20', 'globe'],
    ['Deep research', '20', '80', 'research'],
    ['Tokens', '3M', '12M', 'tokens', '9M bonus tokens added'],
  ] as [string, string, string, string, string?][],
  footnote: '*Bonus tokens apply to your first month only',
  policy: 'Token Usage Policy Applies',
  policyHref: 'https://anniversary.aifiesta.ai/terms',
};

// "What you pay today" calculator. Yearly INR prices from the aifiesta.ai pricing calculator;
// `on` marks the tools selected by default.
export const payTools = [
  { name: 'ChatGPT', icon: '/logos/calc-openai.svg', yearly: 23400, on: true },
  { name: 'Claude', icon: '/logos/calc-claude.svg', yearly: 28788, on: true },
  { name: 'Gemini', icon: '/logos/calc-gemini.svg', yearly: 23400, on: true },
  { name: 'Perplexity', icon: '/logos/calc-perplexity.svg', yearly: 20400 },
  { name: 'Qwen', icon: '/logos/calc-qwen.svg', yearly: 0 },
  { name: 'Meta AI', icon: '/logos/calc-meta.svg', yearly: 0 },
  { name: 'Grok', icon: '/logos/calc-grok.svg', yearly: 34800 },
  { name: 'DeepSeek', icon: '/logos/calc-deepseek.svg', yearly: 0 },
  { name: 'Mistral', icon: '/logos/calc-mistral.svg', yearly: 15000 },
  { name: 'ByteDance', icon: '/logos/calc-bytedance.svg', yearly: 8000 },
  { name: 'Kimi', icon: '/logos/calc-moonshot.svg', yearly: 15000 },
  { name: 'Kling', icon: '/logos/calc-kling.png', yearly: 8800 },
  { name: 'Runway', icon: '/logos/calc-runway.png', yearly: 12000 },
  { name: 'Cohere', icon: '/logos/calc-cohere.svg', yearly: 0 },
  { name: 'MiniMax', icon: '/logos/calc-minimax.svg', yearly: 21960 },
];

// `img` is optional; without it the card shows the person's initials.
export const testimonials: { name: string; role: string; img?: string; text: string }[] = [
  { name: 'Maya Mehta', role: 'Freelancer', img: 'avatar-maya.webp', text: 'Instead of paying for multiple separate subscriptions, getting them combined in one workspace saves a lot of money and effort. Side-by-side output comparison and prompt enhancement tools work well for daily research and content tasks.' },
  { name: 'Aditya Kulkarni', role: 'Content Writer', img: 'avatar-aditya.webp', text: 'I’m a researcher and content writer. I use AI tools for researching and refining my scripts. Paying for all those AI tools every year wasn’t really feasible for me. This feels like a game changer.' },
  { name: 'Shreyanka Patil', role: 'Engineering Student', img: 'avatar-shreyanka.webp', text: 'This app helped me immensely with my board and entrance exams. I didn’t have to keep switching between different AI tools, because I found everything in one place.' },
  { name: 'Vikram Shah', role: 'Business Owner', img: 'avatar-vikram.webp', text: 'I use it every day to draft professional messages for clients, create Excel spreadsheets, manage business accounts and prepare balance sheets. It has become an essential part of my workflow.' },
  { name: 'Deepakshi Verma', role: 'Uses AI Fiesta for presentations and analysis', text: 'I use AI Fiesta for my presentations, statistical analysis, image generation and day-to-day queries. I don’t need to write the full prompt. I just write in plain language and it automatically converts it into a well-structured prompt.' },
  { name: 'Rajiv Sen', role: 'AI Fiesta user for 2 months', img: 'avatar-rajiv.webp', text: 'I got responses from all the tools I’d been using individually on the same screen, and I could pick the best response, at a much cheaper price. I’ve been using it for two months and I’m extremely satisfied.' },
  { name: 'Imran Sheikh', role: 'AI Fiesta user', img: 'avatar-imran.webp', text: 'I can work with different models at the same time and compare them. I also compared the free models, and the quality gap is big. The responses are super fast. I think it’s worth buying.' },
];

// Answers after the first are taken from subscriptionplans.aifiesta.ai/single-subscription-plan-t2.
export const faqs = [
  { q: 'How is AI Fiesta different from subscribing to each AI separately?', a: 'AI Fiesta brings together Grok 4, ChatGPT 5, Gemini 2.5 Pro, DeepSeek, Claude Sonnet 4, Perplexity Sonar Pro, Kimi K2, Qwen 3 Max, Mistral, and many more in one place.' },
  { q: 'Which AI models are included?', a: 'You get 100+ AI models for chat, image and video, and new ones are added as they launch. Here is the full list:', models: true },
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
