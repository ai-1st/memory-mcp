/**
 * HTML / Confluence-storage-format → plain-text (lightly Markdown-flavoured)
 * conversion utilities used by the ingestion pipeline.
 *
 * Two entry points:
 *   - htmlToText()              for rendered HTML (e.g. Jira renderedFields).
 *   - confluenceStorageToText() for Confluence storage format (body.storage),
 *     which is XML containing <ac:structured-macro> / <ac:parameter> /
 *     <ac:plain-text-body> nodes. The generic stripper mangles these: macro
 *     *parameters* (language=bash, layout=wide, width=760) survive as text
 *     while the code body — wrapped in a CDATA section that looks like one big
 *     tag to a naive regex — is silently deleted. confluenceStorageToText()
 *     understands the macro structure and preserves code blocks.
 */

// Sentinel wrapping a protected-block index. Uses NUL control chars that never
// appear in HTML/Confluence content, so a protected block survives tag
// stripping and entity decoding without colliding with real text.
const PH_OPEN = '\x00';
const PH_CLOSE = '\x00';
const PH_RE = /\x00(\d+)\x00/g;

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Collapse a table cell's inner HTML to a single line of plain text. */
function cellToText(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|') // don't break the Markdown column structure
    .trim();
}

/** Render a single <table>…</table> block as a Markdown table. */
function tableToMarkdown(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) =>
      [...m[1].matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => ({
        header: c[1].toLowerCase() === 'th',
        text: cellToText(c[2]),
      }))
    )
    .filter((cells) => cells.length > 0);

  if (rows.length === 0) return '';

  const width = Math.max(...rows.map((r) => r.length));
  const pad = (cells) =>
    '| ' + Array.from({ length: width }, (_, i) => cells[i]?.text ?? '').join(' | ') + ' |';

  const lines = [pad(rows[0])];
  // Markdown requires a header separator after the first row.
  lines.push('| ' + Array.from({ length: width }, () => '---').join(' | ') + ' |');
  for (let i = 1; i < rows.length; i++) lines.push(pad(rows[i]));

  return '\n\n' + lines.join('\n') + '\n\n';
}

/**
 * Convert rendered HTML to plain text. Handles common block-level and inline
 * elements, HTML entities, Markdown tables, and collapses excessive whitespace.
 *
 * Protects table output (and any caller-supplied blocks, e.g. code fences) from
 * the generic tag-stripping pass so cell/code content containing '|' or '<' is
 * not corrupted.
 */
export function htmlToText(html, protectedBlocks = []) {
  if (!html) return '';

  const blocks = [...protectedBlocks];
  const protect = (value) => {
    blocks.push(value);
    return `${PH_OPEN}${blocks.length - 1}${PH_CLOSE}`;
  };

  let s = html;

  // Tables → Markdown (protected from the strip pass below).
  s = s.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    const md = tableToMarkdown(table);
    return md ? protect(md) : '';
  });

  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, '');

  s = decodeEntities(s)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Restore protected blocks (tables, code, …).
  s = s.replace(PH_RE, (_, i) => blocks[Number(i)] ?? '');

  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// Macros that carry no useful body text — only structural/layout parameters
// (which would otherwise leak as garbage tokens like "12truenonelisttrue").
const STRUCTURAL_MACROS = new Set([
  'toc', 'children', 'pagetree', 'recently-updated', 'contributors',
  'anchor', 'excerpt-include', 'detailssummary',
]);

/**
 * Convert Confluence storage format (body.storage) to plain text.
 *
 * - <ac:structured-macro ac:name="code|noformat"> → fenced code block, using
 *   the `language` parameter as the fence info string and preserving the
 *   ac:plain-text-body (CDATA) verbatim.
 * - Structural macros (toc, children, …) are dropped entirely.
 * - All other <ac:parameter> values are dropped (so layout/width/etc. never
 *   leak into the text), while rich-text bodies are unwrapped and kept.
 * - The remainder is handed to htmlToText() for tables, lists, paragraphs.
 */
export function confluenceStorageToText(xml) {
  if (!xml) return '';

  const protectedBlocks = [];
  const protect = (value) => {
    protectedBlocks.push(value);
    return `${PH_OPEN}${protectedBlocks.length - 1}${PH_CLOSE}`;
  };

  let s = xml;

  // 1. Code / noformat macros → protected fenced blocks.
  s = s.replace(
    /<ac:structured-macro\b[^>]*\bac:name="(?:code|noformat)"[\s\S]*?<\/ac:structured-macro>/gi,
    (macro) => {
      const langMatch = macro.match(
        /<ac:parameter\b[^>]*\b(?:ac:)?name="language"[^>]*>([\s\S]*?)<\/ac:parameter>/i
      );
      let lang = langMatch ? langMatch[1].trim() : '';
      // Markdown fence info strings can't contain spaces; "plain text" → none.
      if (!/^[A-Za-z0-9+#.\-]+$/.test(lang)) lang = '';

      const bodyMatch = macro.match(
        /<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>/i
      );
      let body = bodyMatch ? bodyMatch[1] : '';
      const cdata = body.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      // CDATA content is literal; non-CDATA bodies are entity-encoded.
      body = cdata ? cdata[1] : decodeEntities(body);
      body = body.replace(/^\n+|\n+$/g, '');

      return '\n\n' + protect('```' + lang + '\n' + body + '\n```') + '\n\n';
    }
  );

  // 2. Drop structural macros (toc, children, …) along with their parameters.
  s = s.replace(
    /<ac:structured-macro\b[^>]*\bac:name="([^"]+)"[\s\S]*?<\/ac:structured-macro>/gi,
    (macro, name) => (STRUCTURAL_MACROS.has(name.toLowerCase()) ? '\n\n' : macro)
  );
  // Self-closing structural macros (e.g. <ac:structured-macro ac:name="toc"/>).
  s = s.replace(
    /<ac:structured-macro\b[^>]*\bac:name="([^"]+)"[^>]*\/>/gi,
    (macro, name) => (STRUCTURAL_MACROS.has(name.toLowerCase()) ? '\n\n' : macro)
  );

  // 3. Drop all remaining macro parameters so their values don't leak as text.
  s = s
    .replace(/<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/gi, '')
    .replace(/<ac:parameter\b[^>]*\/>/gi, '');

  // 4. Unwrap rich-text bodies and reduce remaining macro shells to breaks so
  //    their inner content survives but adjacent text can't fuse together.
  s = s
    .replace(/<\/?ac:rich-text-body>/gi, '\n')
    .replace(/<ac:structured-macro\b[^>]*>/gi, '\n')
    .replace(/<\/ac:structured-macro>/gi, '\n');

  // 5. Generic HTML conversion for the rest (tables, lists, paragraphs).
  //    Protected code blocks ride through untouched.
  return htmlToText(s, protectedBlocks);
}
