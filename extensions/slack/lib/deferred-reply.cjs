function deferredReply(messages, since) {
  const current = (messages ?? []).filter(message => Number.isSafeInteger(message.at) && message.at >= since);
  const users = current.filter(message => message.role === 'user');
  // A second user turn can come from the panel. Never relay its answer to Slack.
  if (users.length !== 1) return undefined;
  return current.findLast(message => message.at >= users[0].at && message.role === 'bot' &&
    message.kind === 'text' && typeof message.text === 'string' && message.text.trim());
}

module.exports = {deferredReply};
