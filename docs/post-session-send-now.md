# Scheduled post-session Send Now

In Communications, scheduled session FOLLOW_UP messages offer **Send Now**. The detail drawer and row action open a confirmation dialog. This operates on the existing communication, audience, content, attachments, and session recording context. It does not create or reschedule another communication. The existing 24-hour scheduling calculation is unchanged.

The API action `sendPostSessionNow` requires an administrator. Both that action and automatic delivery use the same atomic status claim. Only one worker can change a scheduled/failed, unsent communication to SENDING. A successfully completed communication becomes SENT with its actual provider-acceptance timestamp; its original schedule is retained for history but cannot run again.

Existing AuditLog records hold a frozen delivery envelope and per-recipient write-ahead checkpoints. Recipient addresses are normalized and deduplicated. Confirmed deliveries are skipped on retry, including legacy confirmed EmailEvents. Definite provider rejection remains retryable. A transport interruption, ambiguous provider response, or interrupted SENDING worker requires provider verification before retrying the uncertain recipient; never clear its checkpoint simply to force a resend. This deliberately favors avoiding duplicates over an unsafe automatic retry. A successful provider acceptance checkpoint can repair a missing tracking event without sending again.

Scope is scheduled FOLLOW_UP templates with a session. Other email workflows retain their existing path. No dependencies, database migrations, or additional scheduled jobs are introduced.

## Validation

- Unit coverage: same-message manual send, manual/scheduler concurrency, confirmed-recipient partial retries, immutable retry envelope, uncertain provider outcomes, tracking repair, validation failures, provider request checkpoint, and the real manual/scheduler entry points with mocked HTTP.
- Browser coverage: confirmation/cancel, same-ID send/status update, visible failure/retry, and unchanged unrelated reminder actions.
- Staging was based on origin/staging, separately from production main. A narrow preexisting nullable-return type error was corrected, and the removed Next.js lint command was replaced with ESLint using existing dependencies.
- Staging outbound lock and disabled background jobs are preserved. No customer emails are sent as part of implementation or deployment.
