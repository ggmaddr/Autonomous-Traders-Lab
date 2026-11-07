// A small Markdown renderer for researcher answers: headings, paragraphs, bold,
// italic, inline code, links and lists, built as React elements (no HTML string
// is ever injected, so a model's answer cannot run script). Tickers the desk has
// traded become chips that link to Trades.

import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

const TICKER = /\b[A-Z]{1,5}\b/g;

function inline(text: string, tickers: Set<string>, key: string): ReactNode[] {
  // Links, bold, italic and code first; plain runs then get ticker chips.
  const out: ReactNode[] = [];
  const re = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*\s][^*]*)\*)|(`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  const plain = (s: string) => {
    if (!tickers.size) return [s];
    const parts: ReactNode[] = [];
    let at = 0;
    let t: RegExpExecArray | null;
    TICKER.lastIndex = 0;
    while ((t = TICKER.exec(s))) {
      if (!tickers.has(t[0])) continue;
      if (t.index > at) parts.push(s.slice(at, t.index));
      parts.push(
        <Link key={`${key}-t${n++}`} className="ticker-chip" to={`/trades?symbol=${t[0]}`}>
          {t[0]}
        </Link>,
      );
      at = t.index + t[0].length;
    }
    if (at < s.length) parts.push(s.slice(at));
    return parts;
  };
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...plain(text.slice(last, m.index)));
    const k = `${key}-${n++}`;
    if (m[1])
      out.push(
        <a key={k} className="text-link" href={m[3]} target="_blank" rel="noreferrer">
          {m[2]}
        </a>,
      );
    else if (m[4] || m[6]) out.push(<strong key={k}>{plain(m[5] ?? m[7])}</strong>);
    else if (m[8]) out.push(<em key={k}>{plain(m[9])}</em>);
    else if (m[10]) out.push(<code key={k}>{m[11]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...plain(text.slice(last)));
  return out;
}

export function Markdown({ text, tickers = new Set() }: { text: string; tickers?: Set<string> }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), tickers, `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, tickers, `l${blocks.length}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={`o${blocks.length}`}>{items}</ol> : <ul key={`u${blocks.length}`}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      const level = Math.min(4, h[1].length + 2);
      const Tag = `h${level}` as "h3" | "h4";
      blocks.push(<Tag key={`h${blocks.length}`}>{inline(h[2].replace(/#+$/, ""), tickers, `h${blocks.length}`)}</Tag>);
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
    } else if (/^[-*_]{3,}$/.test(line)) {
      flushPara();
      flushList();
      blocks.push(<hr key={`r${blocks.length}`} />);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return (
    <div className="md">
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
