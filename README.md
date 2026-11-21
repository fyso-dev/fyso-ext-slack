# Fyso Slack extension

An opt-in Copier extension for the Fyso Agentic Framework. Assign project agents
to Slack channels, keep their OpenMausBot conversations in Slack threads, and
enable channels for outbound-only posting.

## Install and connect

1. From the generated project root, run `mise run ext:add slack`.
   To install this version directly, run
   `mise run ext:add gh:fyso-dev/fyso-ext-slack -- --defaults --vcs-ref v0.1.0`.
2. In [Slack API](https://api.slack.com/apps), create an app **From a manifest**
   using [the manifest](extensions/slack/panel/manifest.yaml) and install it to
   your workspace. Use one Slack app per Fyso project.
3. Copy the **Bot User OAuth Token** from **OAuth & Permissions**. Under
   **Basic Information → App-Level Tokens**, generate a token with
   `connections:write`. Paste both into the panel's **Slack** page or **Setup**.
4. Invite the app to the channels it should use. In the panel's **Slack** page,
   select a channel and an agent, or select **Send only**. Choose whether
   new threads require a mention. Run `mise run doctor` to verify the connection.

The bridge uses [Socket Mode](https://docs.slack.dev/tools/node-slack-sdk/socket-mode/).
Keep the selected workspace and app together when rotating tokens. The manifest
subscribes to public and private channel messages so the bridge can continue
known threads without requiring a fresh mention. Only configured channels with
an assigned agent are passed to OpenMausBot.

## Conversation behavior

- A qualifying channel message starts a thread. Mention the app inside an
  existing Slack thread to activate it. Subsequent messages from people in the
  same thread reuse its OpenMausBot task. The bridge serializes turns per thread.
- Use **Reply as** to show the app name or the Fyso agent's name on replies.
  Slack uses the installed app's avatar. The optional agent name uses Slack's
  [customized sender](https://docs.slack.dev/reference/methods/chat.postMessage/#sending-messages-as-other-entities).
- A short status message is edited when the answer arrives, including after a
  deferred approval or timeout. Thread associations and deferred reply
  checkpoints live under `.data/ext/slack/`. Slack gets its event acknowledgement
  before the agent runs, so an interruption during a new turn can require sending
  the message again.
- Inbound Slack-hosted attachments support up to five files, 10 MiB per image
  and 25 MiB combined. Slack Connect files requiring a separate access grant,
  DMs, outbound files and automatic OpenMausBot avatar synchronization are
  outside this version.

The panel stores assignments in `project/slack.yaml`. See
[the example](extensions/slack/slack.example.yaml) for manual edits.
Run `mise run slack:send -- <channel-id> <message>` for top-level posting to
an enabled channel. Enable the Slack skill for agents that need to post.

## Verify

Run `npm ci --prefix extensions/slack` and `node --test tests/*.test.cjs`.
For workspace acceptance, use a public and a private test channel. Try a
mention, a follow-up without a mention, an unassigned channel, a file-only
follow-up, and an approval completed in the Fyso panel. Confirm that the
messages and deferred reply arrive in their original threads.
