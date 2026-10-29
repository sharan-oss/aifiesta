export const modelGroups: { title: string; models: string[] }[] = [
  {
    title: 'Chat models',
    models: [
      'Claude Opus 5.5', 'Claude Opus 5', 'Claude Sonnet 5.5', 'Claude Sonnet 5', 'Claude Haiku 5.5', 'Claude Haiku 4.5', 'Claude Sonnet 4.6', 'Claude Opus 4.8',
      'GPT-6.1 Sol', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5', 'GPT-5.4', 'GPT-5.4 mini', 'GPT-5.4 nano', 'GPT-5.2', 'GPT-5.1', 'GPT-5', 'GPT-5 mini', 'GPT-5 nano', 'GPT-4.1', 'GPT-4.1 nano', 'GPT-4o', 'GPT-4o mini',
      'Gemini 3.8 Flash', 'Gemini 3.5 Flash Lite', 'Gemini 3.1 Pro', 'Gemini 3.1 Flash Lite', 'Gemini 3 Flash', 'Gemini 2.5 Pro', 'Gemini 2.5 Flash', 'Gemini 2.5 Flash Lite',
      'Grok 4.7', 'Grok 4.5', 'Grok 4.3', 'Grok 4.20 (Reasoning)', 'Grok 4.20 (Non-Reasoning)', 'Grok 4',
      'Qwen 3.8 Max', 'Qwen 3.7 Max', 'Qwen 3.5', 'Qwen 3.5 Plus', 'Qwen 3.5 Flash', 'Qwen Plus', 'Qwen Flash', 'Qwen 3 Coder Flash',
      'Mistral Large 3', 'Mistral Medium', 'Mistral Small', 'Magistral Medium', 'Ministral Small 4', 'Ministral 3 8B', 'Ministral 3 3B', 'Codestral',
      'DeepSeek V4 Pro', 'DeepSeek V4.1 Flash', 'DeepSeek Reasoner', 'DeepSeek Chat',
      'Command A', 'Command R', 'Command R7B', 'Kimi K3', 'Kimi K2.5', 'Perplexity Sonar Pro', 'Perplexity Sonar', 'Nova Pro', 'Nova Lite', 'Nova Micro',
    ],
  },
  { title: 'Image generation models', models: ['Nano Banana', 'GPT Image 1.5', 'GPT Image 1', 'Seedream 5.0', 'Seedream 4.0', 'Grok Imagine Pro'] },
  {
    title: 'Video generation models',
    models: ['Kling 3.0', 'Kling 3.0 Omni', 'Wan 3.0 Prime', 'Wan 3.0', 'Wan 2.7', 'Seedance 2.5', 'Seedance 2.0', 'Veo 3.1', 'Gemini Omni Flash', 'Runway Gen-4.5', 'MiniMax H3', 'MiniMax Hailuo 02'],
  },
];
export const modelCount = modelGroups.reduce((n, g) => n + g.models.length, 0);
