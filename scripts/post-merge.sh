#!/bin/bash
set -e

npm install --prefer-offline --no-audit --no-fund 2>&1 || true

# Schema changes come from versioned migrations (migrations/*.sql), never db:push.
npm run db:migrate 2>&1
