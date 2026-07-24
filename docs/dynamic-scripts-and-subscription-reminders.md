# Dynamic Scripts and Subscription Reminders

## App Backend APIs

These endpoints are served by the Krita app backend because the mobile/web app consumes them at runtime.

### GET `/api/scripts`

Query:

- `platform`: `android`, `ios`, or `web`

Returns enabled scripts matching the requested platform or `All`, sorted by priority.

### POST `/api/subscription-reminders/track`

Authenticated app user endpoint. Creates or refreshes a pending reminder schedule.
When the active reminder configuration has `immediateReminderEnabled` enabled, this endpoint sends reminder #1 immediately and schedules the next reminder using `initialDelay`.

Body:

- `eventType`: `razorpay_closed`, `payment_cancelled`, `payment_failed`, `back_pressed`, `subscription_page_exit`, `app_closed_during_payment`, `subscription_abandoned`, or `payment_timeout`
- `platform`: `android`, `ios`, or `web`
- `subscriptionId`
- `subscriptionPlan`

### POST `/api/subscription-reminders/complete`

Authenticated app user endpoint. Marks pending reminders complete after successful purchase.

## Admin APIs

All admin APIs require the existing admin bearer token.

### Third Party Scripts

- `GET /api/admin/scripts`
- `GET /api/admin/scripts/:id`
- `POST /api/admin/scripts`
- `PUT /api/admin/scripts/:id`
- `DELETE /api/admin/scripts/:id`
- `PATCH /api/admin/scripts/status` with `{ "id": "...", "status": "enabled" }`
- `POST /api/admin/scripts/:id/duplicate`

### Subscription Reminder

- `GET /api/admin/subscription-reminder/statistics`
- `GET /api/admin/subscription-reminder/configurations`
- `POST /api/admin/subscription-reminder/configurations`
- `PUT /api/admin/subscription-reminder/configurations/:id`
- `DELETE /api/admin/subscription-reminder/configurations/:id`
- `PATCH /api/admin/subscription-reminder/configurations/status`
- `GET /api/admin/subscription-reminder/cancelled-users`
- `GET /api/admin/subscription-reminder/cancelled-users/:id`
- `PATCH /api/admin/subscription-reminder/cancelled-users/:id/stop`
- `PATCH /api/admin/subscription-reminder/cancelled-users/:id/restart`
- `GET /api/admin/subscription-reminder/logs`
- `GET /api/admin/subscription-reminder/logs/user/:userId`

The subscription reminder scheduler runs every minute from the app backend process. Immediate cancellation reminders are also sent by the app backend during `/api/subscription-reminders/track`. The admin backend only manages configuration and reporting for the admin panel.
