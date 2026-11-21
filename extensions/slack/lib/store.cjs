const fs = require('node:fs');
const path = require('node:path');
const {validChannel, validId} = require('./config.cjs');

function openStore(file, log = console.error) {
  let entries = new Map();
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
    for (const [id, entry] of Object.entries(data)) {
      if (!(/^[CG][A-Z0-9]{8,}:\d+\.\d{6}$/).test(id) || !validId(entry?.taskId) || !validChannel(entry?.channelId) ||
          !['idle', 'waiting', 'working'].includes(entry?.state)) throw Error();
    }
    entries = new Map(Object.entries(data));
  } catch (error) {
    if (error.code !== 'ENOENT') log('Could not load Slack thread registry');
  }

  return {
    get: id => entries.get(id),
    all: () => new Map(entries),
    set(id, entry) {
      const updated = new Map(entries).set(id, entry);
      const temporary = file + '.tmp';
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(updated)) + '\n', {mode: 0o600});
      fs.renameSync(temporary, file);
      entries = updated;
    },
  };
}

module.exports = {openStore};
