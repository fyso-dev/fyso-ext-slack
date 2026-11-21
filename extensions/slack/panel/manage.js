import {
  createElement as h, mountExtensionPage, useDaguAction, useEffect, useState, useStore, useTranslation,
} from '/assets/extension-sdk.js';

const messages = Object.fromEntries(await Promise.all(['es', 'en'].map(async language =>
  [language, await (await fetch(`./locales/${language}.json`)).json()])));
const workflow = 'ext-slack-manage';
const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const portal = 'https://api.slack.com/apps';
const tokenErrors = new Set(['token_missing', 'token_invalid']);

// Connect Slack, then enable channels and optional agent replies.
// Identity and permissions are automatic and only surface when something needs a fix.
function SlackPage() {
  const {t} = useTranslation();
  const {backend} = useStore();
  const action = useDaguAction(backend, workflow, 'result');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [token, setToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [editingTokens, setEditingTokens] = useState(false);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(null); // {channel, bot, mentionRequired, instructions, editing}
  const [removing, setRemoving] = useState('');
  const i = (key, options) => t('slack.' + key, options);

  async function reload() {
    const result = await action.start({REQUEST_B64: encode({op: 'status'})});
    if (!result || result.error) { setError(result?.error || 'operation_failed'); setData(null); }
    else setData(result);
  }

  async function connect(event) {
    event.preventDefault();
    if (!token.trim() || !appToken.trim() || busy) return;
    setBusy(true); setError(''); setToken(''); setAppToken('');
    try {
      const response = await fetch('/api/extensions/slack/secrets', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({values: {SLACK_BOT_TOKEN: token.trim(), SLACK_APP_TOKEN: appToken.trim()}}),
      });
      if (!response.ok) throw Error();
      setEditingTokens(false);
      await reload();
    } catch { setError('operation_failed'); } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setError(''); setNotice('');
    try { await reload(); } catch { setError('operation_failed'); } finally { setBusy(false); }
  }

  useEffect(() => { void refresh(); }, []);

  async function save(op, channel, values = {}) {
    setBusy(true); setError(''); setNotice('');
    try {
      const current = data.assignments.find(item => item.channel === channel);
      const result = await action.start({REQUEST_B64: encode({
        op, channel, bot: values.bot ?? '', mentionRequired: values.mentionRequired, instructions: values.instructions,
        senderMode: values.senderMode ?? 'app', previousSenderMode: current?.senderMode ?? 'app',
        previousPresent: Boolean(current), previous: current?.bot ?? '', previousMentionRequired: current?.mentionRequired ?? true,
      })});
      if (!result?.saved) { setError(result?.error || 'operation_failed'); return; }
      setNotice(op === 'remove' ? 'removed' : 'saved');
      setForm(null); setRemoving('');
      await reload();
    } catch { setError('operation_failed'); } finally { setBusy(false); }
  }

  const btn = (label, onClick, kind = 'soft', extra = {}) => h('button', {
    type: 'button', className: 'btn btn-sm btn-' + kind, disabled: busy, onClick, ...extra,
  }, i(label));
  const link = (href, label, kind = 'soft') => h('a', {
    href, target: '_blank', rel: 'noopener noreferrer', className: 'btn btn-sm btn-' + kind,
  }, i(label));
  const pill = (text, ok) => h('span', {className: 'pill pill-' + (ok ? 'ok' : 'warn')}, text);

  const channels = data?.channels ?? [];
  const assigned = new Set(data?.assignments?.map(item => item.channel));
  const detailOf = new Map(channels.map(item => [item.id, item]));
  const agentName = new Map(data?.bots?.map(item => [item.id, item.name]));
  const channelLabel = item => '#' + item.name + ' · ' + item.guild;
  const locked = busy || data?.configError;

  // Step 1: the Slack bot itself.
  function botStep() {
    const connection = tokenErrors.has(error) ? 'token_missing' : data?.connection;
    const ready = connection === 'connected';
    let body = null;
    if (connection === 'token_missing' || editingTokens) {
      body = [h('p', {key: 'p'}, i(error === 'token_invalid' ? 'bot.tokenInvalid' : 'bot.tokenMissing')),
        h('div', {key: 'a', className: 'slack-row'},
          link(portal, 'bot.openPortal'), link('./manifest.yaml', 'bot.manifest')),
        h('form', {key: 'token', onSubmit: connect, className: 'slack-row'},
          h('label', null, i('bot.token'), h('input', {type: 'password', autoComplete: 'new-password',
            value: token, maxLength: 4096, disabled: busy, onChange: event => setToken(event.target.value)})),
          h('label', null, i('bot.appToken'), h('input', {type: 'password', autoComplete: 'new-password',
            value: appToken, maxLength: 4096, disabled: busy, onChange: event => setAppToken(event.target.value)})),
          h('button', {type: 'submit', className: 'btn btn-sm btn-pri',
            disabled: busy || !token.trim() || !appToken.trim()}, i('bot.openSetup')))];
    } else if (data) {
      body = [
        h('p', {key: 'p'}, ready ? i('bot.connected', {name: data.name}) : i('bot.connecting')),
        h('div', {key: 'a', className: 'slack-row'}, btn('bot.changeTokens', () => setEditingTokens(true))),
        !channels.length && h('p', {key: 'h', className: 'hint'}, i('bot.inviteHelp')),
      ];
    }
    return h('section', {className: 'card slack-stack', 'aria-labelledby': 'slack-bot'},
      h('div', {className: 'slack-row slack-between'},
        h('h2', {id: 'slack-bot'}, i('bot.title')),
        connection && pill(i('states.' + connection, {defaultValue: connection}), ready)),
      body);
  }

  // One plain sentence about what is wrong with an assigned channel, or null.
  function problem(item) {
    const detail = detailOf.get(item.channel);
    if (!detail) return i('problems.noAccess');
    if (item.bot && !agentName.has(item.bot)) return i('problems.unknownAgent');
    return null;
  }

  function editor() {
    const options = form.editing
      ? channels.filter(item => item.id === form.channel)
      : channels.filter(item => !assigned.has(item.id));
    const set = patch => setForm({...form, ...patch});
    const choice = (value, label) => h('label', {className: 'slack-row'},
      h('input', {type: 'radio', name: 'slack-trigger', checked: form.mentionRequired === value, disabled: locked,
        onChange: () => set({mentionRequired: value})}), i(label));
    return h('form', {className: 'slack-stack slack-editor', onSubmit: event => {
      event.preventDefault(); void save('set', form.channel, form);
    }},
    h('div', {className: 'slack-fields'},
      h('label', null, i('form.channel'),
        h('select', {value: form.channel, required: true, disabled: locked || form.editing,
          onChange: event => set({channel: event.target.value})},
        !form.editing && h('option', {value: ''}, i('form.chooseChannel')),
        options.map(item => h('option', {value: item.id, key: item.id}, channelLabel(item))))),
      h('label', null, i('form.agent'),
        h('select', {value: form.bot, disabled: locked, onChange: event => set({bot: event.target.value})},
          h('option', {value: ''}, i('form.chooseAgent')),
          data.bots.map(item => h('option', {value: item.id, key: item.id}, item.name))))),
    form.bot && h('fieldset', {className: 'slack-stack slack-choice'},
      h('legend', null, i('form.when')),
      choice(true, 'form.onMention'),
      choice(false, 'form.onEvery')),
    form.bot && h('label', null, i('form.sender'),
      h('select', {value: form.senderMode, disabled: locked, onChange: event => set({senderMode: event.target.value})},
        h('option', {value: 'app'}, i('form.senderApp')),
        h('option', {value: 'agent'}, i('form.senderAgent')))),
    form.bot && h('label', {className: 'slack-stack slack-instructions'}, i('form.instructions'),
      h('textarea', {value: form.instructions, rows: 3, maxLength: 2000, disabled: locked,
        placeholder: i('form.instructionsExample'), onChange: event => set({instructions: event.target.value})}),
      h('span', {className: 'hint'}, i('form.instructionsHelp'))),
    !form.editing && !options.length && h('p', {className: 'hint'}, i('form.noFreeChannels')),
    h('div', {className: 'slack-row'},
      h('button', {type: 'submit', className: 'btn btn-sm btn-pri',
        disabled: locked || !form.channel || (form.bot && !agentName.has(form.bot))}, i('form.save')),
      btn('form.cancel', () => setForm(null))));
  }

  // Step 2: which agent answers in which channel.
  function channelStep() {
    const usable = Array.isArray(data?.assignments);
    return h('section', {className: 'card slack-stack', 'aria-labelledby': 'slack-channels'},
      h('h2', {id: 'slack-channels'}, i('channels.title')),
      h('p', {className: 'hint'}, i('channels.help')),
      !usable && !busy && h('p', {className: 'hint'}, i('channels.needsBot')),
      usable && data.configError && h('p', {role: 'alert', className: 'banner banner-down'}, i('errors.invalid_config')),
      usable && !data.assignments.length && !form && h('p', null, i('channels.empty')),
      usable && data.assignments.length > 0 && h('ul', {className: 'slack-list'}, data.assignments.map(item => {
        if (form?.editing && form.channel === item.channel) return h('li', {key: item.channel}, editor());
        const detail = detailOf.get(item.channel);
        const issue = problem(item);
        return h('li', {key: item.channel, className: 'slack-stack'},
          h('div', {className: 'slack-row slack-between'},
            h('strong', null, detail ? channelLabel(detail) : item.channel),
            pill(issue ? i('channels.attention') : i('channels.ok'), !issue)),
          h('p', null, item.bot ? i('channels.summary',  {
            agent: agentName.get(item.bot) ?? item.bot,
            when: i(item.mentionRequired ? 'channels.onMention' : 'channels.onEvery'),
          }) : i('channels.outbound')),
          item.bot && item.instructions && h('p', {className: 'hint slack-quote'}, item.instructions),
          issue && h('p', {className: 'hint'}, issue),
          removing === item.channel
            ? h('div', {className: 'slack-row'}, h('span', null, i('channels.confirmRemove')),
              btn('channels.remove', () => void save('remove', item.channel), 'pri'),
              btn('form.cancel', () => setRemoving('')))
            : h('div', {className: 'slack-row'},
              btn('channels.edit', () => setForm({channel: item.channel, bot: item.bot,
                mentionRequired: item.mentionRequired, senderMode: item.senderMode, instructions: item.instructions ?? '', editing: true}), 'soft', {disabled: locked || Boolean(form)}),
              btn('channels.remove', () => setRemoving(item.channel), 'soft', {disabled: locked || Boolean(form)}),
              issue && detail?.slackUrl && link(detail.slackUrl, 'channels.openInSlack')));
      })),
      usable && form && !form.editing && editor(),
      usable && !form && (channels.length
        ? h('div', null, btn('channels.add', () => setForm({channel: '', bot: '', mentionRequired: true, senderMode: 'app', instructions: '', editing: false}),
          data.assignments.length ? 'soft' : 'pri', {disabled: locked}))
        : h('p', {className: 'hint'}, i('channels.noVisible'))));
  }

  return h('main', {className: 'slack-page', 'aria-busy': busy},
    h('header', {className: 'slack-row slack-between'},
      h('h1', null, i('title')),
      btn('refresh', refresh)),
    busy && h('p', {role: 'status', className: 'hint'}, i('loading')),
    error && !tokenErrors.has(error) && h('p', {role: 'alert', className: 'banner banner-down'},
      i('errors.' + error, {defaultValue: i('errors.operation_failed')})),
    notice && h('p', {role: 'status', className: 'banner'}, i(notice)),
    botStep(),
    channelStep());
}

mountExtensionPage(SlackPage, messages);
