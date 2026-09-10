import fs from 'fs';

// Dynamically evaluate getSystemPrompt by extracting function
const src = fs.readFileSync('lib/ai/prompt-templates.ts', 'utf8');
// Run via Function - hacky but works for audit
const fnBody = src.replace(/^[\s\S]*?export function getSystemPrompt/, 'function getSystemPrompt').replace(/export const SUGGESTED_PROMPTS[\s\S]*/, '');
const getSystemPrompt = new Function(`${fnBody}; return getSystemPrompt;`)();

const env = fs.readFileSync('.env.local', 'utf8');
const key = env.match(/GEMINI_API_KEY="([^"]+)"/)?.[1];
const base = env.match(/GEMINI_API_URL="([^"]+)"/)?.[1] || 'https://generativelanguage.googleapis.com/v1beta/openai';
const endpoint = `${base}/chat/completions`;

const systemPrompt = getSystemPrompt('vite');
const userPrompt = 'Build a fullstack todo app with Supabase PostgreSQL schema and MySQL schema files';

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: 'gemini-3.5-flash-lite',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt + '\n\nNote: output must be XML!! Emphasis! use ```filename=... format' },
    ],
    temperature: 0.3,
    max_tokens: 8000,
  }),
});

const json = await res.json();
const content = json.choices?.[0]?.message?.content || '';
console.log('STATUS:', res.status);
console.log('CONTENT_LEN:', content.length);
console.log('HAS_filename_format:', /filename=/i.test(content));
console.log('HAS_app_page:', /app\/page\.tsx/i.test(content));
console.log('HAS_src_App:', /src\/App\.tsx/i.test(content));
console.log('HAS_sql:', /\.sql/i.test(content));
console.log('HAS_server_js:', /server\.js/i.test(content));

const fenceRegex = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
const files = {};
let m, i = 1;
while ((m = fenceRegex.exec(content)) !== null) {
  const header = (m[1] || '').trim();
  const pathMatch = header.match(/(?:filename|path|file)=["']?([^"'\s}]+)["']?/i);
  let path = pathMatch?.[1];
  if (!path && header.includes('json')) path = 'package.json';
  if (!path && content.includes('export default function Home')) path = 'app/page.tsx';
  if (!path) path = `unknown_${i++}`;
  files[path] = (m[2] || '').length;
}
console.log('PARSED_FILE_PATHS:', Object.keys(files));
console.log('FILE_COUNT:', Object.keys(files).length);
