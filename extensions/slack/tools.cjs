const fs = require('node:fs');
const path = require('node:path');
const {loadConfig, validChannel, validId, yamlModule} = require('./lib/config.cjs');
const {listBots} = require('./lib/omb.cjs');

const {slackApi, appTokenPresent, requireMembership} = require('./lib/slack.cjs');
const {randomUUID} = require('node:crypto');
const configPath = () => path.join(process.env.FYSO_ROOT || process.cwd(), 'project', 'slack.yaml');

function editConfig(file, edit) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const lock = file + '.lock';
  const fd = fs.openSync(lock, 'wx', 0o600);
  try { return editLocked(file, edit); }
  finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function editLocked(file, edit) {
  let source = '';
  let stat;
  try {
    source = fs.readFileSync(file, 'utf8');
    stat = fs.statSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const yaml = yamlModule();
  const doc = yaml.parseDocument(source);
  if (doc.errors.length || (doc.contents && !yaml.isMap(doc.contents))) {
    throw Error('Fix project/slack.yaml before adding a channel');
  }
  edit(doc, yaml);
  // Do not clobber another edit made while reading the document.
  if (stat && fs.readFileSync(file, 'utf8') !== source) throw Error('Slack configuration changed; retry');
  const temporary = file + '.' + randomUUID();
  try {
    fs.writeFileSync(temporary, String(doc), {flag: 'wx', mode: stat?.mode ?? 0o644});
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function editChannel(file, channel, bot, {expected, expectedPresent, previousMentionRequired, mentionRequired, senderMode, previousSenderMode, instructions} = {}) {
  if (!validChannel(channel)) throw Error('Channel must be a Slack channel ID');
  if (bot !== null && bot !== '' && !validId(bot)) throw Error('A valid OpenMausBot ID is required');
  return editConfig(file, (doc, yaml) => {
    if (!doc.has('channels')) doc.set('channels', doc.createNode([]));
    const channels = doc.get('channels', true);
    if (!yaml.isSeq(channels)) throw Error('channels must be a list');
    const existing = channels.items.find(item => yaml.isMap(item) && item.get('channel') === channel);
    const changedBot = expected !== undefined && (existing?.get('bot') ?? '') !== expected;
    const currentMentionRequired = existing?.get('mentionRequired') !== false;
    const changedTrigger = previousMentionRequired !== undefined && previousMentionRequired !== currentMentionRequired;
    const changedSender = previousSenderMode !== undefined && (existing?.get('senderMode') ?? 'app') !== previousSenderMode;
    if ((expectedPresent !== undefined && Boolean(existing) !== expectedPresent) || changedBot || changedTrigger || changedSender) {
      throw Object.assign(Error('Slack assignment changed; reload and retry'), {code: 'assignment_changed'});
    }
    if (bot === null) {
      if (!existing) return;
      channels.delete(channels.items.indexOf(existing));
    } else {
      const entry = existing ?? doc.createNode({channel, bot});
      if (bot) entry.set('bot', bot);
      else entry.delete('bot');
      if (mentionRequired === false) entry.set('mentionRequired', false);
      else if (mentionRequired === true && entry.has('mentionRequired')) entry.set('mentionRequired', true);
      if (senderMode === 'agent' || (senderMode === 'app' && entry.has('senderMode'))) entry.set('senderMode', senderMode);
      if (typeof instructions === 'string') {
        if (instructions.trim()) entry.set('instructions', instructions.trim());
        else entry.delete('instructions');
      }
      if (!existing) channels.add(entry);
    }
  });
}

async function sendMessage(file, channel, content, api) {
  if (!validChannel(channel)) throw Error('Channel must be a Slack channel ID');
  const {channels, errors} = loadConfig(file);
  if (errors.length || !channels.has(channel)) throw Error('A configured Slack channel is required');
  if (!content.trim() || content.length > 3500) throw Error('Send between 1 and 3500 characters');
  await requireMembership(api, channel);
  const {messageParams} = require('./lib/slack.cjs');
  const result = await api('chat.postMessage', messageParams(channel, content));
  if (!result.ts) throw Error('Slack did not confirm the message timestamp');
  return result.ts;
}

async function check({file, api, appToken, port, gateway}) {
  const {channels, errors} = loadConfig(file);
  let authenticated = false;
  if (!appTokenPresent(appToken)) errors.push('Set SLACK_APP_TOKEN in Setup');
  if (gateway() !== 'connected') errors.push('Slack Socket Mode is disconnected. Check both tokens and Socket Mode.');
  try {
    await api('auth.test');
    authenticated = true;
  } catch (error) { errors.push(error.message); }
  if (authenticated) {
    for (const channel of channels.keys()) {
      await requireMembership(api, channel).catch(error => errors.push(channel + ': ' + error.message));
    }
  }
  if ([...channels.values()].some(Boolean)) {
    try {
      const bots = await listBots({port});
      for (const [channel, bot] of channels) {
        if (bot && !bots.has(bot)) errors.push('Channel ' + channel + ' references an unknown project agent');
      }
    } catch (error) { errors.push(error.message); }
  }
  return errors;
}

async function main([command, ...args]) {
  const file = configPath();
  if (command === 'add' && args.length === 2) {
    editChannel(file, ...args);
    console.log('Commit project/slack.yaml');
    return;
  }
  const api = slackApi(process.env.SLACK_BOT_TOKEN);
  if (command === 'send' && args.length === 2) {
    console.log('Slack message sent: ' + await sendMessage(file, ...args, api));
    return;
  }
  if (command !== 'check' || args.length) throw Error('Usage: tools.cjs check | add <channel-id> <bot-id> | send <channel-id> <message>');
  const {gatewayFile, readGateway} = require('./lib/gateway-state.cjs');
  const errors = await check({
    file, api, appToken: process.env.SLACK_APP_TOKEN, port: process.env.FYSO_OMB_PORT,
    gateway: () => readGateway(gatewayFile(process.env.FYSO_ROOT || process.cwd())),
  });
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Slack Socket Mode and channel assignments verified');
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = {editChannel, configPath, sendMessage, check};
