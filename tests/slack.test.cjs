const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createBridge} = require('../extensions/slack/bridge.cjs');
const {manage} = require('../extensions/slack/manage.cjs');
const {editChannel, sendMessage} = require('../extensions/slack/tools.cjs');
const {uploadAttachments} = require('../extensions/slack/lib/attachments.cjs');

const channel = 'C0123456789';
const ts = '1234567890.123456';
const nextTs = '1234567890.123457';
const account = {user_id: 'UAPP', bot_id: 'BAPP', team_id: 'TWORK'};
function event(fields = {}, team_id = account.team_id) {
  return {type: 'event_callback', team_id,
    event: {type: 'message', channel, channel_type: 'channel', ts, user: 'UHUMAN', text: 'Hi <@UAPP>', ...fields}};
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const file = path.join(root, 'project', 'slack.yaml');
  editChannel(file, channel, 'support', {instructions: 'Be concise', senderMode: 'agent'});
  const calls = [];
  const turns = [];
  const api = async (method, args) => {
    calls.push([method, args]);
    switch (method) {
      case 'chat.postMessage': return {ts};
      case 'chat.update': return {ok: true};
      case 'users.info': return {user: {profile: {display_name: 'Ana'}}};
      case 'auth.test': return {user: 'fyso', team: 'Demo'};
      case 'users.conversations':
        return args.cursor ? {channels: [{id: 'G0123456789', name: 'private'}]} : {
          channels: [{id: channel, name: 'support'}], response_metadata: {next_cursor: 'next'},
        };
      case 'conversations.info': return {channel: {id: args.channel, is_channel: true, is_member: args.channel === channel}};
      default: throw Error(method);
    }
  };
  const roster = async () => [{id: 'support', name: 'Support'}];
  const options = {root, port: '4567', account, api, roster, run: async turn => {
    turns.push(turn);
    return {exitCode: 0, threadId: 'task-1', reply: {text: 'Reply'}};
  }};
  return {file, calls, turns, options};
}

test('routes human messages once, preserves agent context and suppresses mentions in output', async t => {
  const {calls, options, turns} = fixture(t);
  const bridge = createBridge(options);
  await bridge.onMessage(event({text: 'No mention'}));
  await bridge.onMessage(event({bot_id: 'BBOT'}));
  await bridge.onMessage(event({app_id: 'AAPP'}));
  await bridge.onMessage(event({}, 'TOTHER'));
  await bridge.onMessage(event({subtype: 'message_changed'}));
  assert.equal(turns.length, 0);
  await Promise.all([bridge.onMessage(event()), bridge.onMessage(event())]);
  await createBridge(options).onMessage(event({ts: nextTs, thread_ts: ts, text: 'Follow-up'}));
  assert.deepEqual(turns.map(({taskId, text}) => [taskId, text]), [
    ['new', '[Slack channel instructions]\nBe concise\n\nAna: Hi'], ['task-1', 'Ana: Follow-up'],
  ]);
  const [, sent] = calls.find(([method]) => method === 'chat.postMessage');
  assert.equal(sent.thread_ts, ts);
  assert.equal(sent.username, 'Support');
  assert.equal(sent.link_names, false);
  assert.equal(sent.mrkdwn, false);
  const {messageParams} = require('../extensions/slack/lib/slack.cjs');
  assert.equal(messageParams(channel, '<!channel> & <@UAPP>').text, '&lt;!channel&gt; &amp; &lt;@UAPP&gt;');
});

test('recovers a deferred reply in its original thread after restarting', async t => {
  const {calls, options} = fixture(t);
  const initial = createBridge({...options, run: async () => ({exitCode: 3, threadId: 'task-1', since: 100})});
  await initial.onMessage(event());
  const resumed = createBridge({...options, wait: async args => {
    assert.deepEqual(args, {taskId: 'task-1', since: 100, port: '4567'});
    return {idle: true, exitCode: 0, messages: [
      {role: 'user', at: 100}, {role: 'bot', kind: 'text', at: 101, text: 'Approved reply'},
    ]};
  }});
  await resumed.deliverPending();
  await resumed.deliverPending();
  const updates = calls.filter(([method]) => method === 'chat.update').map(([, args]) => args);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].channel, channel);
  assert.equal(updates[1].ts, ts);
  assert.equal(updates[1].text, 'Approved reply');
});

test('panel lists channels across pages and checks stale assignment and access', async t => {
  const {file, options} = fixture(t);
  const deps = {file, api: options.api, roster: options.roster, gateway: () => 'connected'};
  const result = await manage({op: 'status'}, deps);
  assert.deepEqual(result.channels.map(({name}) => name), ['private', 'support']);
  const edit = {op: 'set', channel, bot: '', previous: 'support', previousPresent: true,
    previousMentionRequired: true, previousSenderMode: 'agent', mentionRequired: false, senderMode: 'app', instructions: ''};
  assert.deepEqual(await manage(edit, deps), {saved: true});
  await assert.rejects(manage(edit, deps), {code: 'assignment_changed'});
  await assert.rejects(manage({...edit, channel: 'G0123456789'}, deps), {code: 'missing_access'});
  assert.equal(await sendMessage(file, channel, 'Hello', options.api), ts);
  await assert.rejects(sendMessage(file, 'G0123456789', 'Hello', options.api), /configured Slack channel/);
});

test('passes the Slack token only to an approved attachment URL and uploads to the project port', async () => {
  const calls = [];
  const data = '/project/.data';
  const result = await uploadAttachments([
    {id: 'F1', name: 'report.txt', size: 4, url: 'https://files.slack.com/files-pri/TWORK-F1/download/report.txt'},
    {id: 'F2', name: 'bad.txt', size: 4, url: 'https://example.com/files-pri/TWORK-F2/bad.txt'},
  ], {data, token: 'fake', port: '4567', messageId: ts, fetcher: async (url, init) => {
    calls.push([String(url), init]);
    return calls.length === 1 ? new Response('test') :
      Response.json({path: '/project/.data/omb/attachments/1234.txt'});
  }});
  assert.equal(result.rejected, 1);
  assert.equal(result.tags.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer fake');
  assert.equal(calls[0][1].redirect, 'error');
  assert.match(calls[1][0], /^http:\/\/127\.0\.0\.1:4567\/api\/files\?/);
  assert.equal(calls[1][1].headers.Authorization, undefined);
});
