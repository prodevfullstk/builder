import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const key = env.match(/GEMINI_API_KEY="([^"]+)"/)?.[1];
const base = env.match(/GEMINI_API_URL="([^"]+)"/)?.[1] || 'https://generativelanguage.googleapis.com/v1beta/openai';
const url = `${base}/chat/completions`;
const models = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

console.log('KEY_SET:', !!key);
for (const model of models) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 10 }),
  });
  const text = await res.text();
  console.log(`${model}: ${res.status} ${text.slice(0, 220)}`);
}
