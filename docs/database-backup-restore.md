# Database backup and restore

The admin backend runs the database scheduler; it does not depend on an open browser. At the configured UTC hour it creates one compressed MongoDB archive and removes completed manual/automatic archives older than the retention window.

The Database Backup page shows the most recent completed backup and the next scheduled run in the browser's local time. A main admin can persistently enable or disable automatic backups with the page toggle; the environment value supplies its initial default.

## VPS prerequisites

Install a MongoDB Database Tools release compatible with the server so `mongodump` and `mongorestore` are available to the backend process. The service account running Node must have read/write access to `DATABASE_BACKUP_DIR`; use a persistent volume with restrictive filesystem permissions and enough capacity for at least eight full database archives.

Set these environment values before restarting the admin backend:

```dotenv
DATABASE_BACKUP_ENABLED=true
DATABASE_BACKUP_DIR=/var/lib/krita-admin/database-backups
DATABASE_BACKUP_RETENTION_DAYS=7
DATABASE_BACKUP_HOUR_UTC=2
MONGODUMP_BINARY=/usr/bin/mongodump
MONGORESTORE_BINARY=/usr/bin/mongorestore
```

The existing `MONGODB_URI` is passed directly to MongoDB Database Tools and is never returned by the API or written to an operation error. Keep it in the process environment rather than source control.

## Safety behavior

- Backups use `mongodump --archive --gzip` and do not modify live data.
- Only main-admin accounts can view or operate this module.
- Manual backup and download require the current password.
- Restore requires password verification, a five-minute one-use authorization, and a separate final confirmation.
- Restore first creates a safety archive. If that backup fails, restore does not begin.
- `mongorestore --drop` replaces only collections present in the selected archive. The operation-history collection is excluded from archives so audit/status records survive a restore.
- Tool errors are recorded with the MongoDB URI redacted.

Before enabling restores in production, test both commands against a staging database and verify archive download, restore results, available disk space, and filesystem ownership. If more than one admin-backend instance is deployed, enable the scheduler on only one instance by setting `DATABASE_BACKUP_ENABLED=false` on the others.
