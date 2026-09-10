import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const key = env.match(/GEMINI_API_KEY="([^"]+)"/)?.[1];
const base = env.match(/GEMINI_API_URL="([^"]+)"/)?.[1] || 'https://generativelanguage.googleapis.com/v1beta/openai';
const endpoint = `${base}/chat/completions`;

// Minimal system prompt excerpt
const systemPrompt = fs.readFileSync('lib/ai/prompt-templates.ts', 'utf8');
const promptMatch = systemPrompt.match(/return `([\s\S]*?)`;/);
const fullSystem = promptMatch ? promptMatch[1].slice(0, 500) + '...[truncated]' : 'truncated';

const userPrompt = 'Build a simple todo app with Supabase SQL schema in supabase/migrations/001.sql and MySQL alternative in sql/schema.sql';

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: 'gemini-3.5-flash-lite',
    messages: [
      { role: 'system', content: 'Generate files using ```tsx filename=path format. Include supabase SQL if asked.' },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4000,
  }),
});

const json = await res.json();
const content = json.choices?.[0]?.message?.content || '';
console.log('STATUS:', res.status);
console.log('CONTENT_LEN:', content.length);
console.log('HAS_SUPABASE:', /supabase|\.sql/i.test(content));
console.log('HAS_MYSQL:', /mysql/i.test(content));
console.log('FENCE_COUNT:', (content.match(/```/g) || []).length / 2);
console.log('SAMPLE:', content.slice(0, 400));

// Parse like code-parser
const fenceRegex = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
const files = [];
let m;
while ((m = fenceRegex.exec(content)) !== null) {
  const header = m[1] || '';
  const pathMatch = header.match(/(?:filename|path|file)=["']?([^"'\s}]+)["']?/i);
  files.push(pathMatch?.[1] || header.slice(0, 40) || 'unknown');
}
console.log('PARSED_FILES:', files);
