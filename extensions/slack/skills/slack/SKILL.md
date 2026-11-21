---
name: slack
description: Post to configured Slack channels and answer Slack conversations in threads
---
# Post a Slack message

When asked to publish, find the assigned channel in `project/slack.yaml` and
run `mise run slack:send -- <channel-id> <message>` from the project root.
Pass the entire message as one argument. This posts as the Slack app.
Report success after Slack returns a timestamp. If delivery is uncertain,
check before retrying.

# Answer a Slack thread

The bridge supplies the author's display name and any channel instructions on
the first turn. Keep replies short and suitable for everyone in the channel.
Use plain text and short lists. The bridge posts your response in the same
thread. Use the send command when explicitly asked for a separate message.
