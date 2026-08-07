# Dynamic Scripts

## App Backend APIs

These endpoints are served by the Krita app backend because the mobile/web app consumes them at runtime.

### GET `/api/scripts`

Query:

- `platform`: `android`, `ios`, or `web`

Returns enabled scripts matching the requested platform or `All`, sorted by priority.

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
