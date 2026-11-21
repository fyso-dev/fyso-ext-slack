const fs = require('node:fs');
const path = require('node:path');
const {SocketModeClient} = require('@slack/socket-mode');
const {loadConfig} = require('./lib/config.cjs');
const {projectPort, waitForTurn, botRoster, runAgent} = require('./lib/omb.cjs');
const {statusText, outcome} = require('./lib/route.cjs');
const {splitMessage} = require('./lib/split.cjs');
const {openStore} = require('./lib/store.cjs');
const {perKey} = require('./lib/queue.cjs');
const {uploadAttachments, attachmentTurn, withInstructions} = require('./lib/attachments.cjs');
const {deferredReply} = require('./lib/deferred-reply.cjs');
const {gatewayFile, writeGateway} = require('./lib/gateway-state.cjs');
const {slackApi, logger, appTokenPresent, messageParams} = require('./lib/slack.cjs');
const {channelMessage, assignedTurn, timestamp} = require('./lib/event.cjs');

function createBridge({root, data = path.join(root, '.data'), port, account, api, token,
  roster = () => botRoster({port}), run = runAgent, wait = waitForTurn}) {
  const configFile = path.join(root, 'project', 'slack.yaml');
  const threads = openStore(path.join(root, '.data', 'ext', 'slack', 'threads.json'));
  const enqueue = perKey();
  let config = loadConfig(configFile);
  if (config.errors.length) throw Error('Fix project/slack.yaml before starting the bridge');
  let polling = false;

  function reload() {
    const next = loadConfig(configFile, config);
    if (next.errors.length) {
      next.errors.forEach(error => console.error(error));
      return;
    }
    config = next;
  }

  function post(channel, thread, text, name) {
    return api('chat.postMessage', messageParams(channel, text, thread, name));
  }

  async function sendReply(channel, thread, text, name, progress) {
    if (progress) {
      const params = messageParams(channel, text);
      try {
        await api('chat.update', {channel, ts: progress, text: params.text, as_user: true,
          mrkdwn: false, parse: 'none', link_names: false});
        return;
      } catch (error) {
        if (error.code !== 'cannot_edit') throw error;
      }
    }
    await post(channel, thread, text, name);
  }

  async function completePending(key, entry) {
    const {pending, channelId, taskId} = entry;
    if (config.channels.get(channelId) !== entry.botId) return false;
    const result = await wait({taskId, since: pending?.since, port});
    if (!result.idle) return false;
    if (pending && config.channels.get(channelId) === entry.botId) {
      const reply = deferredReply(result.messages, pending.since);
      const text = reply?.text ?? (result.exitCode !== 0 ? statusText('failed', config.language) : '');
      const chunks = splitMessage(text, 3500);
      for (let i = pending.sent ?? 0; i < chunks.length; i++) {
        await sendReply(channelId, pending.thread, chunks[i], pending.name, i === 0 ? pending.progress : undefined);
        threads.set(key, {...entry, pending: {...pending, sent: i + 1}});
      }
    }
    threads.set(key, {...entry, state: 'idle', pending: undefined});
    return true;
  }

  async function processMessage(message) {
    const {channel, key, thread, ts} = message;
    const entry = threads.get(key);
    const turn = assignedTurn(message, config, entry, account.user_id);
    if (!turn) return;
    const language = config.language;
    if (turn.busy && !(await completePending(key, entry))) {
      await post(channel, thread, statusText(entry.state === 'waiting' ? 'needsInput' : 'timeout', language));
      return;
    }
    const bot = (await roster()).find(candidate => candidate.id === turn.botId);
    if (!bot || config.channels.get(channel) !== turn.botId) return;
    const files = message.files.slice(0, 5).map(file => ({
      id: file?.id, name: file?.name, url: file?.url_private_download ?? file?.url_private, size: file?.size,
    }));
    const attachments = await uploadAttachments(files, {port, data, messageId: channel + ':' + ts, token});
    if (attachments.rejected || message.files.length > files.length) {
      await post(channel, thread, statusText('attachmentRejected', language));
    }
    if (!turn.caption && !attachments.tags.length && message.files.length) return;
    const user = await api('users.info', {user: message.user}).then(({user}) =>
      user?.profile?.display_name || user?.real_name || user?.name || message.user, () => message.user);
    const caption = turn.caption || (attachments.tags.length ? statusText('attachmentOnly', language) : message.text);
    const text = attachmentTurn(user, caption, attachments.tags);
    const instructions = turn.taskId === 'new' ? config.instructions.get(channel) : undefined;
    const name = config.senderModes.get(channel) === 'agent' ? bot.name?.slice(0, 80) : undefined;
    if (config.channels.get(channel) !== turn.botId) return;
    const progress = await post(channel, thread, statusText('typing', language), name)
      .then(result => timestamp.test(result.ts) ? result.ts : undefined, () => undefined);
    const seen = [...(entry?.seen ?? []).slice(-99), ts];
    if (turn.taskId !== 'new') {
      threads.set(key, {...entry, state: 'working', pending: undefined, seen});
    }
    const result = await run({botId: turn.botId, taskId: turn.taskId, text: withInstructions(text, instructions), port})
      .catch(() => ({exitCode: 1}));
    const reply = outcome(result);
    const taskId = result.threadId ?? (turn.taskId === 'new' ? undefined : turn.taskId);
    if (taskId) {
      const pending = ['waiting', 'working'].includes(reply.state) && result.since
        ? {since: result.since, thread, progress, name} : undefined;
      threads.set(key, {taskId, channelId: channel, botId: turn.botId, seen,
        state: reply.kind === 'failed' ? 'working' : reply.state, pending});
    }
    if (config.channels.get(channel) !== turn.botId) return;
    const chunks = splitMessage(reply.text ?? statusText(reply.kind, language), 3500);
    for (const [i, chunk] of chunks.entries()) {
      await sendReply(channel, thread, chunk, name, i === 0 ? progress : undefined);
    }
  }

  return {
    configFile, reload,
    onMessage(body) {
      const message = channelMessage(body, account);
      if (message) return enqueue(message.key, () => processMessage(message));
    },
    async deliverPending() {
      if (polling) return;
      polling = true;
      try {
        for (const [key, entry] of threads.all()) {
          if (!entry.pending || config.channels.get(entry.channelId) !== entry.botId) continue;
          await enqueue(key, async () => {
            const current = threads.get(key);
            if (current?.pending) await completePending(key, current);
          }).catch(() => console.error('Slack could not deliver a deferred turn'));
        }
      } finally { polling = false; }
    },
  };
}

async function main() {
  const port = projectPort(process.env.FYSO_OMB_PORT);
  const token = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!appTokenPresent(appToken)) throw Error('Set SLACK_APP_TOKEN in Setup');
  const api = slackApi(token);
  const account = await api('auth.test');
  if (!/^[UW][A-Z0-9]+$/.test(account.user_id ?? '') || !account.bot_id || !account.team_id) {
    throw Error('Slack did not return a workspace bot');
  }
  const root = process.env.FYSO_ROOT || process.cwd();
  const bridge = createBridge({root, port, token, api, account, data: process.env.FYSO_DATA});
  fs.watchFile(bridge.configFile, {interval: 2000, persistent: false}, bridge.reload);
  const socket = new SocketModeClient({appToken, logger});
  let connected = false;
  const health = state => {
    connected = state === 'connected';
    try { writeGateway(gatewayFile(root), state); }
    catch { console.error('Could not record Slack Socket Mode health'); }
  };
  socket.on('connected', () => { health('connected'); void bridge.deliverPending(); });
  socket.on('reconnecting', () => health('connecting'));
  socket.on('disconnected', () => health('offline'));
  socket.on('error', () => console.error('Slack Socket Mode error'));
  socket.on('slack_event', ({body, ack}) => {
    Promise.resolve().then(() => ack()).then(() => bridge.onMessage(body))
      .catch(() => console.error('Slack bridge could not process a message'));
  });
  const heartbeat = setInterval(() => {
    if (!connected) return;
    health('connected');
    void bridge.deliverPending();
  }, 15_000);
  heartbeat.unref();
  const stop = async () => {
    clearInterval(heartbeat);
    fs.unwatchFile(bridge.configFile);
    health('offline');
    await socket.disconnect().catch(() => {});
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  health('connecting');
  await socket.start().catch(() => { throw Error('Slack Socket Mode could not connect'); });
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
module.exports = {createBridge};
