/**
 * Usage: OPEN_AI_KEY=xxx node generate-description.mjs /path/to/dir
 *
 * Set the OPEN_AI_KEY environment variable in your shell or prefix the command.
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';


const fetch = globalThis.fetch || (await import('node-fetch')).default;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4.1-mini';

if (!OPENAI_API_KEY) {
  console.error('Error: OPEN_AI_KEY environment variable is not set. Set it in your shell or in a .env file.');
  process.exit(1);
}

if (process.argv.length < 3) {
  console.error('Usage: OPEN_AI_KEY=xxx node generate-description.mjs /path/to/dir');
  process.exit(1);
}

const rootDir = process.argv[2];

const PROMPT = `
You are an AI model specializing in generating concise and effective SEO descriptions from article content. Your goal is to create a compelling summary that encourages clicks from search engine results.

Your input will be the full text of an article.

Your output should be an SEO description meeting the following criteria:

1.  **Conciseness:** The description should be a short paragraph with one or two sentences, each no longer than 30 words. Use one sentence if you can.
2.  **Keyword Inclusion:** Identify and incorporate the most relevant keywords from the article that are likely to be used by users searching for this topic.
3.  **Simple English:** Use clear, easy-to-understand language accessible to a broad audience. Avoid jargon or overly complex sentences.
4.  **Compelling:** Write the description in a way that accurately reflects the article's content while also enticing users to click and read more.
5.  **No extra information:** Do not include any extra information, characters, symbols. Just output the plain text of the description.

Generate the SEO description based on the provided article content.
`;

async function findMarkdownFiles(dir) {
  let results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(await findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function generateDescription(articleContent) {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: articleContent }
      ],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const desc = data.choices?.[0]?.message?.content?.trim();
  if (!desc) throw new Error('No description generated by OpenAI.');
  return desc;
}

async function processFile(filePath) {
  let updated = false;
  let logMsg = '';
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = matter(raw);

    let desc = parsed.data?.description;
    if (desc === undefined || desc === null || (typeof desc === 'string' && desc.trim() === '')) {
      // Generate description
      const contentForAI = parsed.content;
      const generatedDesc = await generateDescription(contentForAI);
      // Ensure description is a single line
      parsed.data.description = generatedDesc.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
      let newRaw = matter.stringify(parsed.content, parsed.data);

      // Force inline description in YAML frontmatter
      newRaw = newRaw.replace(
        /description:\s*[|>]-?\s*\n([\s\S]*?)(\n[a-zA-Z0-9_-]+:|\n---)/,
        (match, descBlock, nextFieldOrEnd) => {
          // Remove indentation and join lines
          const desc = descBlock
            .split('\n')
            .map(line => line.trim())
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          return `description: ${desc}${nextFieldOrEnd}`;
        }
      );

      await fs.writeFile(filePath, newRaw, 'utf8');
      updated = true;
      logMsg = `✅ Updated: ${filePath}`;
    } else {
      logMsg = `⏩ Skipped (description exists): ${filePath}`;
    }
  } catch (err) {
    logMsg = `❌ Failed: ${filePath} - ${err.message}`;
  }
  console.log(logMsg);
  return { filePath, updated, logMsg };
}

async function main() {
  try {
    const files = await findMarkdownFiles(rootDir);
    if (files.length === 0) {
      console.log('No markdown files found.');
      return;
    }
    let updatedCount = 0;
    for (const file of files) {
      const result = await processFile(file);
      if (result.updated) updatedCount++;
    }
    console.log(`\nProcess completed. ${updatedCount} file(s) updated out of ${files.length}.`);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
