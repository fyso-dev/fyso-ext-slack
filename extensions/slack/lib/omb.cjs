const {execFile} = require('node:child_process');
const {validId} = require('./config.cjs');

function projectPort(port) {
  const value = String(port);
  if (!/^[0-9]{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw Error('FYSO_OMB_PORT must be an integer from 1 to 65535');
  }
  return value;
}

function requireId(id) {
  if (!validId(id)) throw Error('Invalid OpenMausBot ID');
}

function invoke(bin, args, {text, timeout}) {
  const env = {...process.env};
  delete env.SLACK_BOT_TOKEN;
  delete env.SLACK_APP_TOKEN;
  // The port must select the project even if a caller also exported a desktop URL.
  delete env.OPENMAUSBOT_URL;
  return new Promise(resolve => {
    const child = execFile(bin, args, {maxBuffer: 4 * 1024 * 1024, timeout, env},
      (error, stdout) => {
        const exitCode = Number.isInteger(error?.code) ? error.code : error ? 1 : 0;
        try {
          const value = JSON.parse(stdout);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
          resolve({exitCode, value});
        } catch {
          resolve({exitCode: 1});
        }
      });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
}

async function runAgent({botId, taskId, text, port, bin = 'openmausbot'}) {
  requireId(botId);
  requireId(taskId);
  const {exitCode, value} = await invoke(bin, [
    'run', '--bot', botId, '-', '--port', projectPort(port), '--json', '--task', taskId,
    '--timeout', '30m', '--on-input', 'exit', '--on-timeout', 'leave',
  ], {text, timeout: 31 * 60_000});
  const result = {exitCode};
  if (validId(value?.threadId)) result.threadId = value.threadId;
  if (Number.isSafeInteger(value?.since) && value.since > 0) result.since = value.since;
  if (typeof value?.reply?.text === 'string') result.reply = {text: value.reply.text};
  return result;
}

async function waitForTurn({taskId, port, since, bin = 'openmausbot'}) {
  requireId(taskId);
  if (since !== undefined && (!Number.isSafeInteger(since) || since <= 0)) throw Error('Invalid turn timestamp');
  const {exitCode, value} = await invoke(bin, [
    'wait', '--thread', taskId, '--port', projectPort(port), '--json',
    '--timeout', '5s', '--on-input', 'exit', '--on-timeout', 'leave',
    ...(since === undefined ? [] : ['--since', String(since)]),
  ], {timeout: 15_000});
  // A native engine failure can settle the job with exit 1. CLI errors have no job.
  const settledFailure = exitCode === 1 && ['failed', 'stalled'].includes(value?.state) &&
    ['idle', 'completed', 'failed'].includes(value?.job?.state);
  return {idle: exitCode === 0 || settledFailure, exitCode, messages: value?.messages};
}

async function isIdle(options) {
  return (await waitForTurn(options)).idle;
}

async function botRoster({port, fetcher = fetch}) {
  const response = await fetcher('http://127.0.0.1:' + projectPort(port) + '/api/bots?messages=0', {
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('Could not list project agents');
  const {bots} = await response.json();
  if (!Array.isArray(bots)) throw Error('Could not list project agents');
  return bots.map(({id, name, color, avatarUrl, mascotBody, mascotFaceColor}) => ({
    id, name, color, avatarUrl, mascotBody, mascotFaceColor,
  }));
}

async function listBots(options) {
  return new Set((await botRoster(options)).map(bot => bot.id));
}

module.exports = {projectPort, runAgent, isIdle, waitForTurn, listBots, botRoster};
