#!/usr/bin/env node

/**
 * Replace the contents of a dedicated Notion page with a Markdown file from the repository
 * (docs/NOTION.md by default). The repository stays the source of truth: every existing block
 * on the page is archived, so the page must be dedicated to FLEK.
 *
 *   npm run notion                      replaces the page
 *   NOTION_DRY_RUN=1 npm run notion     only converts and counts blocks
 *
 * NOTION_TOKEN and NOTION_PAGE_ID are read from the environment or from .env.local.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = { ...readEnvFile('.env.local'), ...process.env };
const token = env.NOTION_TOKEN;
const pageId = env.NOTION_PAGE_ID?.replace(/.*([0-9a-f]{32}).*/i, '$1').replaceAll('-', '');
const dryRun = env.NOTION_DRY_RUN === '1';
const source = resolve(process.cwd(), process.argv[2] ?? 'docs/NOTION.md');
const apiVersion = '2022-06-28';
const endpoint = 'https://api.notion.com/v1';

const blocks = markdownToBlocks(readFileSync(source, 'utf8'));

if (dryRun) {
  console.log(`Dry run: ${blocks.length} Notion bloků z ${source}.`);
  process.exit(0);
}
if (!token || !pageId) {
  console.error('Chybí NOTION_TOKEN nebo NOTION_PAGE_ID (v prostředí nebo v .env.local).');
  process.exit(1);
}

async function notion(path, options = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${endpoint}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': apiVersion,
        'Content-Type': 'application/json',
      },
    });
    if (response.status === 429 && attempt < 5) {
      await new Promise((done) => setTimeout(done, 1000 * (attempt + 1)));
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Notion API ${response.status}: ${body.message ?? response.statusText}`);
    return body;
  }
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

function readEnvFile(name) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
  );
}

function markdownToBlocks(markdown) {
  const result = [];
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();

    if (line.startsWith('```')) {
      const code = [];
      for (i += 1; i < lines.length && !lines[i].startsWith('```'); i += 1) code.push(lines[i]);
      result.push({ object: 'block', type: 'code', code: { rich_text: plain(code.join('\n')), language: 'plain text' } });
      continue;
    }
    if (!line.trim()) continue;

    if (line.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith('|'); i += 1) {
        if (!/^\|[\s:|-]+\|$/.test(lines[i].trim())) rows.push(cells(lines[i]));
      }
      i -= 1;
      const width = Math.max(...rows.map((row) => row.length));
      result.push({
        object: 'block',
        type: 'table',
        table: {
          table_width: width,
          has_column_header: true,
          has_row_header: false,
          children: rows.map((row) => ({
            object: 'block',
            type: 'table_row',
            table_row: { cells: Array.from({ length: width }, (_, c) => inline(row[c] ?? '')) },
          })),
        },
      });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const type = `heading_${heading[1].length}`;
      result.push({ object: 'block', type, [type]: { rich_text: inline(heading[2]) } });
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      result.push({ object: 'block', type: 'callout', callout: { rich_text: inline(quote[1]), icon: { type: 'emoji', emoji: 'ℹ️' }, color: 'gray_background' } });
      continue;
    }
    const todo = line.match(/^[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (todo) {
      result.push({ object: 'block', type: 'to_do', to_do: { rich_text: inline(todo[2]), checked: todo[1] !== ' ' } });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      result.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: inline(bullet[1]) } });
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      result.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: inline(numbered[1]) } });
      continue;
    }
    result.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: inline(line) } });
  }
  return result;
}

function cells(row) {
  return row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function plain(text) {
  const chunks = [];
  for (let index = 0; index < text.length; index += 1900) chunks.push({ type: 'text', text: { content: text.slice(index, index + 1900) } });
  return chunks.length ? chunks : [{ type: 'text', text: { content: '' } }];
}

/** **bold**, `code`, [text](https://link) and bare https:// links. */
function inline(text) {
  const parts = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\[([^\]]+)\]\([^)]*\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ type: 'text', text: { content: text.slice(last, match.index) } });
    if (match[1]) parts.push({ type: 'text', text: { content: match[1] }, annotations: { bold: true } });
    else if (match[2]) parts.push({ type: 'text', text: { content: match[2] }, annotations: { code: true } });
    else if (match[3]) parts.push({ type: 'text', text: { content: match[3], link: { url: match[4] } } });
    else if (match[5]) parts.push({ type: 'text', text: { content: match[5] } });
    else parts.push({ type: 'text', text: { content: match[6], link: { url: match[6] } } });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: { content: text.slice(last) } });
  return parts.length ? parts : [{ type: 'text', text: { content: '' } }];
}
