#!/bin/sh
set -e

# Railway (and other platforms) mount persistent volumes as root:root,
# overriding the image-time chown. Fix ownership at boot before dropping
# privileges, so the non-root nextjs user can write the SQLite file.
if [ -d /app/data ]; then
  chown -R nextjs:nodejs /app/data 2>/dev/null || true
fi

exec su-exec nextjs:nodejs "$@"
