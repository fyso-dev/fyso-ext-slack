const {WebClient, LogLevel} = require('@slack/web-api');
const {validChannel} = require('./config.cjs');

const logger = {debug() {}, info() {}, warn() {}, error() {}, setLevel() {}, getLevel: () => LogLevel.ERROR,
  setName() {}};
const appTokenPresent = token => typeof token === 'string' && /^xapp-[A-Za-z0-9-]+$/.test(token);
const errors = {
  not_authed: 'token_invalid', invalid_auth: 'token_invalid', token_revoked: 'token_invalid',
  account_inactive: 'token_invalid', channel_not_found: 'missing_channel', not_in_channel: 'missing_access',
  missing_scope: 'missing_scope', restricted_action: 'missing_access',
  cant_update_message: 'cannot_edit', message_not_found: 'cannot_edit', edit_window_closed: 'cannot_edit',
};
const fail = code => Object.assign(Error('Slack: ' + code), {code});

function slackApi(token) {
  if (!token) return async () => { throw fail('token_missing'); };
  if (!/^xoxb-[A-Za-z0-9-]+$/.test(token)) return async () => { throw fail('token_invalid'); };
  const client = new WebClient(token, {
    logger, timeout: 10_000, retryConfig: {retries: 0}, rejectRateLimitedCalls: true,
  });
  return async (method, params = {}) => {
    try { return await client.apiCall(method, params); }
    catch (error) {
      if (error.code === 'slack_webapi_rate_limited_error') throw fail('rate_limited');
      throw fail(Object.hasOwn(errors, error.data?.error) ? errors[error.data.error] : 'unreachable');
    }
  };
}

async function requireMembership(api, channel) {
  if (!validChannel(channel)) throw fail('invalid_input');
  const {channel: info} = await api('conversations.info', {channel});
  if (!info || (!info.is_channel && !info.is_group) || info.is_archived) throw fail('unsupported_channel');
  if (!info.is_member) throw fail('missing_access');
  return info;
}

async function listChannels(api) {
  const channels = [];
  let cursor;
  do {
    const page = await api('users.conversations', {
      types: 'public_channel,private_channel', exclude_archived: true, limit: 200, cursor,
    });
    channels.push(...(page.channels ?? []).filter(channel => validChannel(channel.id) && !channel.is_archived));
    cursor = page.response_metadata?.next_cursor;
  } while (cursor);
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

function messageParams(channel, text, thread, name) {
  return {
    channel, text: text.replace(/[&<>]/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[char]),
    thread_ts: thread, username: name,
    mrkdwn: false, parse: 'none', link_names: false, unfurl_links: false, unfurl_media: false,
  };
}

module.exports = {slackApi, logger, appTokenPresent, requireMembership, listChannels, messageParams};
