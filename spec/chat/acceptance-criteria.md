# Phase 3 — Chat Features: Acceptance Criteria

## A. Threads
1. A reply with `thread_root=<root_id>` increments
   `messages[root_id]["thread_reply_count"]`.
2. `threads:list-replies` returns replies in `(sequence)` order.

## B. DMs
1. `dm:open([a, b])` and `dm:open([b, a])` return the same
   `dm_<hash>` channel and emit only one `channel.create`.
2. The DM channel has `private=True` and `type="dm"`.

## C. Mentions
1. Sending with `mentions=["usr_x"]` where `usr_x` is not a workspace
   member is `invalid_payload`.
2. Sending with `mentions=["usr_x", "usr_y"]` produces two
   `notification.create` events (excluding the sender).

## D. Search
1. `search:messages(workspace_id, "hello")` finds the message
   "Hello world!" (case-insensitive).
2. NFKC normalisation: `search("ｈｅｌｌｏ")` matches "hello" and
   vice versa.
3. CJK content matches per character (Japanese: searching for "猫"
   matches "猫が好きです").
4. Optional `channel_ids` narrows the result set.

## E. Unread
1. After 5 sends in `ch_general` and a `chat:mark-read` up to the
   3rd message, `unread:by-channel(usr, ws)["ch_general"] == 2`.
2. Mentions count is independent: 5 sends with the actor mentioned in
   2 of them ⇒ `mention_count == 2`.

## F. Notifications
1. A mention emits one `notification.create` per mentioned user.
2. `notifications:mark-read` flips `read=True`.

## G. Scheduled + reminders
1. `chat:schedule-message(fire_at=T+60s)` adds an entry to
   `state.scheduled_messages` with `status="pending"`.
2. The drainer at `T+61s` materialises a `message.send`.
3. `chat:set-reminder` materialises a `notification.create` at
   `fire_at`.

## H. Roles
1. `member` cannot run `workspace:invite`.
2. `admin` can run `workspace:invite` but not `workspace:set-role`.
3. `owner` can run both.
