const path = require('node:path');
const {createHash} = require('node:crypto');
const {projectPort} = require('./omb.cjs');

const mb = 1024 * 1024;
const maxFiles = 5;
const maxImages = 10 * mb;
const maxBytes = 25 * mb;
const images = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'], ['webp', 'image/webp'],
]);
const files = new Map(Object.entries({
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', pdf: 'application/pdf', rtf: 'application/rtf',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg',
  wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/opus',
  flac: 'audio/flac', aac: 'audio/aac',
}));
const xml = text => text.replace(/[&<>"']/g, char =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);

function downloadUrl(attachment) {
  const url = new URL(attachment.url);
  const parts = /^\/files-pri\/[A-Z0-9]+-(F[A-Z0-9]+)\/(?:download\/)?[^/]+$/.exec(url.pathname);
  if (url.origin !== 'https://files.slack.com' || url.username || url.password ||
      parts?.[1] !== attachment.id) throw Error('Invalid Slack attachment URL');
  return url;
}

function uploadId(messageId, attachmentId) {
  const hex = createHash('sha256').update(messageId + ':' + attachmentId).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16),
    '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
}

async function readBytes(response, limit) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw Error('Attachment download unavailable');
  }
  let size = 0;
  const output = [];
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) throw Error('Attachment exceeded its size limit');
    output.push(chunk);
  }
  if (!size) throw Error('Empty attachment');
  return Buffer.concat(output, size);
}

async function uploadAttachments(attachments, {port, data, messageId, token, fetcher = fetch}) {
  const origin = 'http://127.0.0.1:' + projectPort(port);
  const storage = path.resolve(data, 'omb', 'attachments');
  const tags = [];
  let rejected = Math.max(0, attachments.length - maxFiles);
  let remaining = maxBytes;
  for (const attachment of attachments.slice(0, maxFiles)) {
    try {
      const name = String(attachment.name ?? 'file').replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180);
      const extension = path.extname(name).slice(1).toLowerCase();
      const image = images.has(extension);
      const mime = images.get(extension) ?? files.get(extension);
      const limit = Math.min(image ? maxImages : maxBytes, remaining);
      if (!mime || !Number.isSafeInteger(attachment.size) || attachment.size <= 0 || attachment.size > limit) {
        throw Error('Unsupported attachment');
      }
      const options = () => ({redirect: 'error', signal: AbortSignal.timeout(15_000)});
      const download = await fetcher(downloadUrl(attachment), {...options(), headers: {Authorization: 'Bearer ' + token}});
      const bytes = await readBytes(download, limit);
      remaining -= bytes.length;
      const params = new URLSearchParams({uploadId: uploadId(messageId, attachment.id)});
      if (!image) params.set('name', name);
      const url = origin + (image ? '/api/attachments?' : '/api/files?') + params;
      const upload = await fetcher(url, {...options(), method: 'POST', headers: {'Content-Type': mime}, body: bytes});
      if (!upload.ok) throw Error('OpenMausBot rejected an attachment');
      const saved = await upload.json();
      if (typeof saved.path !== 'string' || !path.isAbsolute(saved.path) ||
          path.dirname(saved.path) !== storage || !/^[a-f0-9-]+\.[a-z0-9]+$/.test(path.basename(saved.path))) {
        throw Error('Invalid OpenMausBot attachment receipt');
      }
      const tag = image ? 'attached-image' : 'attached-file';
      tags.push('<' + tag + ' path="' + xml(saved.path) + '" name="' + xml(name) + '" />');
    } catch { rejected++; }
  }
  return {tags, rejected};
}

// Only the bridge can add native attachment directives to a Slack turn.
const plain = value => value.replace(/<(?=\/?attached-(?:image|file)\b)/gi, '&lt;');

function attachmentTurn(author, caption, tags) {
  return [plain(author + ': ' + caption), ...tags].join('\n\n');
}

// The channel's own instructions travel with the first turn of each thread; OMB keeps them in that conversation.
function withInstructions(text, instructions) {
  return instructions ? '[Slack channel instructions]\n' + plain(instructions) + '\n\n' + text : text;
}

module.exports = {uploadAttachments, attachmentTurn, withInstructions};
