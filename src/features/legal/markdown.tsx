import type { ReactNode } from 'react';
import { Link } from '../../app/router';

/**
 * The small part of Markdown the legal texts use — headings, paragraphs, lists, tables, bold and
 * links — turned into React elements. Nothing is ever inserted as HTML, so the texts cannot carry
 * markup into the page.
 */

export type LegalBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

/** `{{name}}` becomes the value; an unknown name becomes a dash rather than leaking the braces. */
export function fillPlaceholders(source: string, values: Record<string, string | null | undefined>): string {
  return source.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key]?.trim() || '—');
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function parseLegal(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const open: { paragraph: string[]; list: { ordered: boolean; items: string[] } | null } = { paragraph: [], list: null };

  const flush = () => {
    if (open.paragraph.length) blocks.push({ kind: 'paragraph', text: open.paragraph.join(' ') });
    if (open.list) blocks.push({ kind: 'list', ...open.list });
    open.paragraph = [];
    open.list = null;
  };

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    if (trimmed.startsWith('|')) {
      flush();
      const header = cells(trimmed);
      const rows: string[][] = [];
      // The separator row (| --- |) carries nothing to show.
      let next = index + 1;
      if (next < lines.length && /^\|?\s*:?-{3,}/.test(lines[next].trim())) next++;
      while (next < lines.length && lines[next].trim().startsWith('|')) {
        rows.push(cells(lines[next]));
        next++;
      }
      index = next - 1;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const item = /^-\s+(.*)$/.exec(trimmed) ?? /^\d+\.\s+(.*)$/.exec(trimmed);
    if (item) {
      const ordered = !trimmed.startsWith('-');
      if (open.paragraph.length || (open.list && open.list.ordered !== ordered)) flush();
      open.list ??= { ordered, items: [] };
      open.list.items.push(item[1]);
      continue;
    }
    if (open.list) flush();
    open.paragraph.push(trimmed);
  }
  flush();
  return blocks;
}

/** Bold (`**text**`) and links (`[text](/path)` inside the app, `[text](https://…)` outside it). */
export function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = `${match.index}`;
    if (match[1] !== undefined) {
      parts.push(<strong key={key} className="font-bold text-ink">{match[1]}</strong>);
    } else if (match[3].startsWith('/')) {
      parts.push(<Link key={key} to={match[3]} className="font-bold text-ink underline underline-offset-4">{match[2]}</Link>);
    } else if (match[3].startsWith('https://')) {
      parts.push(
        <a key={key} href={match[3]} target="_blank" rel="noopener noreferrer" className="font-bold text-ink underline underline-offset-4">
          {match[2]}
        </a>,
      );
    } else {
      parts.push(match[2]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function slug(text: string): string {
  return text
    .toLocaleLowerCase('cs-CZ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function LegalMarkdown({ source }: { source: string }) {
  return (
    <>
      {parseLegal(source).map((block, index) => {
        if (block.kind === 'heading') {
          if (block.level === 1) {
            return <h1 key={index} className="text-2xl leading-tight font-extrabold tracking-tight text-ink sm:text-3xl">{renderInline(block.text)}</h1>;
          }
          if (block.level === 2) {
            return <h2 key={index} id={slug(block.text)} className="mt-8 scroll-mt-20 text-lg font-extrabold tracking-tight text-ink">{renderInline(block.text)}</h2>;
          }
          return <h3 key={index} className="mt-5 text-base font-extrabold text-ink">{renderInline(block.text)}</h3>;
        }
        if (block.kind === 'paragraph') {
          return <p key={index} className="mt-3 text-base leading-relaxed text-ink/85">{renderInline(block.text)}</p>;
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List key={index} className={`mt-3 flex flex-col gap-2 pl-5 text-base leading-relaxed text-ink/85 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
              {block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1">{renderInline(item)}</li>)}
            </List>
          );
        }
        return (
          // A wide table scrolls sideways on a phone; the region takes focus so a keyboard can scroll it too.
          <div key={index} role="region" aria-label="Tabulka" tabIndex={0} className="mt-4 overflow-x-auto rounded-xl border border-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead className="bg-surface">
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={cellIndex} scope="col" className="px-3 py-2 align-top font-bold text-ink">{renderInline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-line">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-3 py-2 align-top leading-relaxed text-ink/85">{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
