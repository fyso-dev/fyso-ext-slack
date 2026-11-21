const fence = '```';

function fences(text, limit) {
  const markers = [];
  let open = '';
  const lines = /^ {0,3}```([^`\r\n]*)\r?$/gm;
  for (const match of text.matchAll(lines)) {
    const info = match[1].trim();
    if (open && info) continue;
    const next = open ? '' : fence + info + '\n';
    if (next.length + 6 >= limit) continue;
    markers.push({start: match.index, end: match.index + match[0].length, next});
    open = next;
  }
  return markers;
}

function boundary(text, start, max, minimum) {
  if (max >= text.length) return text.length;
  const window = text.slice(start, max);
  for (const separator of ['\n\n', '\n', ' ']) {
    const index = window.lastIndexOf(separator);
    const end = start + index + separator.length;
    if (index > 0 && end > minimum) return end;
  }
  const last = text.charCodeAt(max - 1);
  return last >= 0xd800 && last <= 0xdbff && text.charCodeAt(max) >= 0xdc00 &&
    text.charCodeAt(max) <= 0xdfff ? max - 1 : max;
}

function splitMessage(text, limit = 2000) {
  if (!text.trim()) return [];
  if (!Number.isInteger(limit) || limit < 2) throw RangeError('Invalid message limit');
  if (text.length <= limit) return [text];

  const markers = fences(text, limit);
  const chunks = [];
  let start = 0;
  let index = 0;
  let prefix = '';
  while (start < text.length) {
    const max = start + limit - prefix.length;
    const first = markers[index];
    // Prefer a hard cut over sending an opening fence on its own.
    const minimum = first?.start === start && first.next ? first.end + 1 : start;
    let end = boundary(text, start, max, minimum);
    let nextIndex = index;
    let nextPrefix = prefix;
    for (;;) {
      nextIndex = index;
      nextPrefix = prefix;
      while (markers[nextIndex]?.end <= end) nextPrefix = markers[nextIndex++].next;
      const marker = markers[nextIndex];
      if (marker?.start < end && end < marker.end && marker.start > start) {
        end = marker.start;
        continue;
      }
      if (nextPrefix && end + 4 > max) {
        end = boundary(text, start, max - 4, minimum);
        continue;
      }
      break;
    }
    const suffix = nextPrefix ? '\n' + fence : '';
    const chunk = text.slice(start, end);
    if (chunk.trim() || prefix || suffix) chunks.push(prefix + chunk + suffix);
    start = end;
    index = nextIndex;
    prefix = nextPrefix;
  }
  return chunks;
}

module.exports = {splitMessage};
