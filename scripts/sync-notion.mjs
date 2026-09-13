#!/usr/bin/env node

/**
 * Replace the contents of a dedicated Notion page with docs/PROJECT_STATUS.md.
 *
 * This is deliberately opt-in and boring: the repository remains the source of truth,
 * and the script will not touch a Notion page unless NOTION_REPLACE=1 is set. Keep the
 * target page dedicated to FLEK project notes because existing child blocks are archived.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const token = process.env.NOTION_TOKEN;
const pageId = process.env.NOTION_PAGE_ID?.replaceAll('-', '');
const replace = process.env.NOTION_REPLACE === '1';
const dryRun = process.env.NOTION_DRY_RUN === '1';
const apiVersion = '2022-06-28';
const endpoint = 'https://api.notion.com/v1';

if (!token || !pageId) {
  console.error('Chybí NOTION_TOKEN nebo NOTION_PAGE_ID.');
  process.exit(1);
}
if (!replace && !dryRun) {
  console.error('Bezpečnostní pojistka: nastavte NOTION_REPLACE=1, nebo nejdříve použijte NOTION_DRY_RUN=1.');
  process.exit(1);
}

const markdownPath = resolve(process.cwd(), 'docs/PROJECT_STATUS.md');
const markdown = await readFile(markdownPath, 'utf8');
const blocks = markdownToBlocks(markdown);

if (dryRun) {
  console.log(`Dry run: připraveno ${blocks.length} Notion bloků z ${markdownPath}.`);
  process.exit(0);
}

async function notion(path, options = {}) {
  const response = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': apiVersion,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Notion API ${response.status}: ${body.message ?? response.statusText}`);
  }
  return body;
}

let cursor;
const existing = [];
do {
  const query = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : '?page_size=100';
  const page = await notion(`/blocks/${pageId}/children${query}`);
  existing.push(...(page.results ?? []));
  cursor = page.has_more ? page.next_cursor : undefined;
} while (cursor);

for (const block of existing) {
  await notion(`/blocks/${block.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) });
}

for (let index = 0; index < blocks.length; index += 100) {
  await notion(`/blocks/${pageId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children: blocks.slice(index, index + 100) }),
  });
}

console.log(`Notion aktualizován: ${existing.length} starých bloků archivováno, ${blocks.length} nových vloženo.`);

function markdownToBlocks(source) {
  const result = [];
  let inCode = false;
  let codeLines = [];

  const flushCode = () => {
    if (!codeLines.length) return;
    result.push({
      object: 'block',
      type: 'code',
      code: { rich_text: [{ type: 'text', text: { content: codeLines.join('\n').slice(0, 2000) } }], language: 'plain text' },
    });
    codeLines = [];
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) continue;
    if (/^\|[- :|]+\|$/.test(line)) continue;
    if (line.startsWith('|')) {
      result.push(paragraph(line.replace(/^\||\|$/g, '').split('|').map((part) => part.trim()).join(' · ')));
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const type = `heading_${heading[1].length}`;
      result.push({ object: 'block', type, [type]: { rich_text: richText(heading[2]) } });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      result.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(bullet[1]) } });
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      result.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(numbered[1]) } });
      continue;
    }
    result.push(paragraph(line.replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')));
  }
  if (inCode) flushCode();
  return result;
}

function paragraph(content) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(content) } };
}

function richText(content) {
  const text = String(content);
  const chunks = [];
  for (let index = 0; index < text.length; index += 1900) {
    chunks.push({ type: 'text', text: { content: text.slice(index, index + 1900) } });
  }
  return chunks.length ? chunks : [{ type: 'text', text: { content: '' } }];
}
