import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const key = env.match(/GEMINI_API_KEY="([^"]+)"/)?.[1];
const base = env.match(/GEMINI_API_URL="([^"]+)"/)?.[1] || 'https://generativelanguage.googleapis.com/v1beta/openai';
const url = `${base}/chat/completions`;

const models = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
];

for (const model of models) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with one word: OK' }],
      max_tokens: 5,
    }),
  });
  console.log(`${model}: ${res.status}`);
}

// Simulate generate stream with system prompt snippet
const { getSystemPrompt } = await import('../lib/ai/prompt-templates.ts').catch(async () => {
  // fallback read file
  return { getSystemPrompt: (f) => `framework param was: ${f}` };
});

console.log('\nFramework in prompt test - reading source...');
const src = fs.readFileSync('lib/ai/prompt-templates.ts', 'utf8');
const usesFramework = src.includes('${framework}') || src.match(/framework\s*===/);
console.log('Prompt uses framework variable:', !!usesFramework);
