// render-program-status.js — render ops/PROGRAM-STATUS.md to
// status/program-status.html during the publish build (P2).
// Minimal converter for the controlled PROGRAM-STATUS format:
// ATX headings, pipe tables, "- " bullets, paragraphs, `code`,
// **bold**, [text](url). Anything else passes through as a
// paragraph (escaped). No dependencies.
const fs = require('fs');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}
function render(md) {
  const lines = md.split('\n');
  let html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      html.push(`<h${level}>${inline(line.replace(/^#+ /, ''))}</h${level}>`);
      i++;
    } else if (line.trim().startsWith('|') && lines[i + 1] &&
               /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|')
        .map((c) => inline(c.trim()));
      const head = cells(line);
      html.push('<table><thead><tr>' +
        head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = cells(lines[i]);
        html.push('<tr>' + row.map((c) => `<td>${c}</td>`).join('') + '</tr>');
        i++;
      }
      html.push('</tbody></table>');
    } else if (line.startsWith('- ')) {
      html.push('<ul>');
      while (i < lines.length && lines[i].startsWith('- ')) {
        html.push(`<li>${inline(lines[i].slice(2))}</li>`);
        i++;
      }
      html.push('</ul>');
    } else if (line.trim() === '') {
      i++;
    } else {
      html.push(`<p>${inline(line)}</p>`);
      i++;
    }
  }
  return html.join('\n');
}

const [src, dst, generatedNote] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: node render-program-status.js SRC.md DST.html [NOTE]');
  process.exit(2);
}
let md;
try {
  md = fs.readFileSync(src, 'utf8');
} catch (e) {
  // PROGRAM-STATUS not landed yet (see ops/PROGRAM-STATUS.md blocker):
  // render a placeholder, never fail the publish on a status doc.
  md = '# Program status\n\nProgram status document is not on main yet ' +
    '(landing waits on the auto-merge flip; the draft lives in the ' +
    'P1b/P2 work dir). Publisher states below come from the live ' +
    'publish manifest.\n';
}
const note = generatedNote || '';
const body = render(md);
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Program status — Nepse Decode</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}th{background:#f0f0f0}code{background:#f0f0f0;padding:.1rem .3rem}h1,h2{margin-top:1.5rem}.note{background:#fff8e1;border:1px solid #e6c200;padding:.6rem 1rem}</style>
</head><body>
${note ? `<p class="note">${esc(note)}</p>` : ''}
${body}
</body></html>
`;
fs.mkdirSync(require('path').dirname(dst), { recursive: true });
fs.writeFileSync(dst, page);
console.log(`render-program-status: wrote ${dst}`);
