const {validChannel} = require('./config.cjs');

const timestamp = /^\d+\.\d{6}$/;
function channelMessage(body, account) {
  const event = body?.event;
  if (body?.type !== 'event_callback' || body.team_id !== account.team_id ||
      event?.type !== 'message' || !validChannel(event.channel) ||
      !['channel', 'group'].includes(event.channel_type) ||
      (event.subtype && event.subtype !== 'file_share') ||
      event.bot_id || event.app_id || !/^[UW][A-Z0-9]+$/.test(event.user ?? '') ||
      event.user === account.user_id || typeof event.ts !== 'string' || !timestamp.test(event.ts) ||
      (event.thread_ts !== undefined && (typeof event.thread_ts !== 'string' || !timestamp.test(event.thread_ts)))) return;
  const text = typeof event.text === 'string' ? event.text : '';
  const files = Array.isArray(event.files) ? event.files : [];
  if (!text.trim() && !files.length) return;
  const thread = event.thread_ts ?? event.ts;
  return {channel: event.channel, key: event.channel + ':' + thread, thread, ts: event.ts,
    user: event.user, text, files};
}

function assignedTurn(message, config, entry, userId) {
  const botId = config.channels.get(message.channel);
  if (!botId || entry?.seen?.includes(message.ts)) return;
  const continuing = entry?.botId === botId;
  const mention = new RegExp('<@' + userId + '(?:\\|[^>]+)?>', 'g');
  if (!continuing && !config.withoutMention.has(message.channel) && !message.text.match(mention)) return;
  return {botId, taskId: continuing ? entry.taskId : 'new', busy: continuing && entry.state !== 'idle',
    caption: message.text.replace(mention, '').trim()};
}

module.exports = {channelMessage, assignedTurn, timestamp};
