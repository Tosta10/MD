const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function inline(value) {
  return escape(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
export function renderMarkdown(source) {
  const truncated = source.length > 200000, lines = source.slice(0, 200000).split(/\r?\n/);
  const html = [], fence = String.fromCharCode(96).repeat(3); let code = null, paragraph = [], list = false;
  const flush = () => { if (paragraph.length) { html.push('<p>' + paragraph.map(inline).join('<br>') + '</p>'); paragraph = []; } if (list) { html.push('</ul>'); list = false; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith(fence) || line.trim().startsWith('~~~')) {
      if (code) { html.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>'); code = null; }
      else { flush(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      flush(); const cells = row => row.replace(/^\s*\||\|\s*$/g, '').split('|').map(v => v.trim());
      html.push('<div class="table-scroll"><table><thead><tr>' + cells(line).map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'); i++;
      while (lines[i + 1]?.includes('|') && lines[i + 1].trim()) html.push('<tr>' + cells(lines[++i]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>');
      html.push('</tbody></table></div>'); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flush(); const n = heading[1].length; html.push('<h' + n + '>' + inline(heading[2]) + '</h' + n + '>'); continue; }
    if (/^\s*[-*+]\s+/.test(line)) { if (paragraph.length) flush(); if (!list) { html.push('<ul>'); list = true; } html.push('<li>' + inline(line.replace(/^\s*[-*+]\s+/, '')) + '</li>'); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list) flush();
    if (line.startsWith('>')) { flush(); html.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>'); continue; }
    paragraph.push(line);
  }
  flush(); if (code) html.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>');
  return '<article class="reading-paper markdown-content">' + (truncated ? '<p class="notice">預覽顯示前 200,000 字；完整內容請開啟原文編輯或分段讀取。</p>' : '') + html.join('') + '</article>';
}
