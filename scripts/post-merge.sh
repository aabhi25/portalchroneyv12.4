#!/bin/bash
set -e

npm install --prefer-offline --no-audit --no-fund 2>&1 || true

npm run db:push --force 2>&1 || true
