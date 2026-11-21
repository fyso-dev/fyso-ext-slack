const fs = require('node:fs');
const path = require('node:path');

function readGateway(file) {
  try {
    const {state, at} = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - at < 45_000 && ['connected', 'connecting'].includes(state)) return state;
  } catch {}
  return 'offline';
}

function gatewayFile(root) {
  return path.join(root, '.data', 'ext', 'slack', 'gateway.json');
}

function writeGateway(file, state) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({state, at: Date.now()}), {mode: 0o600});
  fs.renameSync(temporary, file);
}

module.exports = {gatewayFile, readGateway, writeGateway};
