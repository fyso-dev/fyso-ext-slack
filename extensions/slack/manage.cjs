const {loadConfig, validChannel, validId, maxInstructions} = require('./lib/config.cjs');
const {slackApi, listChannels, requireMembership} = require('./lib/slack.cjs');
const {botRoster} = require('./lib/omb.cjs');
const {gatewayFile, readGateway} = require('./lib/gateway-state.cjs');
const {editChannel, configPath} = require('./tools.cjs');

async function manage(input, {api, roster, file, gateway}) {
  const config = loadConfig(file);
  if (input?.op === 'status') {
    const account = await api('auth.test');
    const [bots, channels] = await Promise.all([roster().catch(() => []), listChannels(api)]);
    return {
      connection: gateway(), name: account.user, configError: Boolean(config.errors.length),
      bots: bots.map(({id, name}) => ({id, name})),
      channels: channels.map(({id, name}) => ({
        id, name, guild: account.team,
        slackUrl: 'https://app.slack.com/archives/' + id,
      })),
      assignments: [...config.channels].map(([channel, bot]) => ({
        channel, bot, mentionRequired: !config.withoutMention.has(channel),
        senderMode: config.senderModes.get(channel) ?? 'app',
        instructions: config.instructions.get(channel) ?? '',
      })),
    };
  }
  if (!['set', 'remove'].includes(input?.op) || !validChannel(input.channel) ||
      typeof input.previousPresent !== 'boolean' || typeof input.previous !== 'string' ||
      typeof input.previousMentionRequired !== 'boolean' || !['app', 'agent'].includes(input.previousSenderMode) ||
      (input.op === 'set' && (
        (input.bot !== '' && !validId(input.bot)) || typeof input.mentionRequired !== 'boolean' ||
        !['app', 'agent'].includes(input.senderMode) || typeof input.instructions !== 'string' ||
        input.instructions.trim().length > maxInstructions
      ))) return {error: 'invalid_input'};
  if (config.errors.length) return {error: 'invalid_config'};
  if (input.op === 'set') {
    await requireMembership(api, input.channel);
    if (input.bot && !(await roster()).some(bot => bot.id === input.bot)) return {error: 'unknown_agent'};
  }
  editChannel(file, input.channel, input.op === 'remove' ? null : input.bot, {
    expected: input.previous, expectedPresent: input.previousPresent,
    previousMentionRequired: input.previousMentionRequired, mentionRequired: input.mentionRequired,
    previousSenderMode: input.previousSenderMode, senderMode: input.senderMode, instructions: input.instructions,
  });
  return {saved: true};
}

if (require.main === module) {
  Promise.resolve().then(() => {
    const encoded = process.argv[2];
    if (!encoded || encoded.length > 16384 || !/^[a-zA-Z0-9+/=]+$/.test(encoded)) return {error: 'invalid_input'};
    const input = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return manage(input, {
      api: slackApi(process.env.SLACK_BOT_TOKEN),
      roster: () => botRoster({port: process.env.FYSO_OMB_PORT}),
      file: configPath(),
      gateway: () => readGateway(gatewayFile(process.env.FYSO_ROOT || process.cwd())),
    });
  }).catch(error => ({error: [
    'token_missing', 'token_invalid', 'unreachable', 'rate_limited', 'missing_access', 'missing_scope',
    'missing_channel', 'unsupported_channel', 'assignment_changed',
  ].includes(error.code) ? error.code : 'operation_failed'})).then(value => console.log(JSON.stringify(value)));
}

module.exports = {manage};
