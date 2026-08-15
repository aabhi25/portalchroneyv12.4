# AI Chroney — Full-Stack Chat & Business Platform

## Overview

AI Chroney is a full-stack Express + React application providing:
- AI-powered chat interface (streaming, voice, markdown)
- Business account management with WhatsApp & CRM integrations
- Shopify product sync and lead capture widget
- K-12 educational content management (TopScholar)
- Embeddable widget (`public/widget.js`) for third-party sites

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Express.js (TypeScript, ESM) |
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| Database | PostgreSQL (Drizzle ORM + pgvector) |
| Auth | Passport.js (session-based) |
| AI | OpenAI, Google Gemini |
| Storage | Cloudflare R2 / AWS S3 / Google Cloud Storage |

## How to Run

```bash
npm run dev        # Development server (port 5000)
npm run build      # Production build
npm run start      # Production server
npm run db:push    # Push schema changes to database
```

The workflow **"Start application"** runs `npm run dev` and serves on port 5000.

## Default Login

On first boot, a superadmin account is created automatically:
- **Username:** `admin`
- **Password:** `admin123`

Change these immediately by setting `SUPERADMIN_USERNAME` and `SUPERADMIN_PASSWORD` environment variables, or updating in the app.

## Required Environment Variables

### Critical (app won't work without these)
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (auto-provisioned by Replit) |
| `SESSION_SECRET` | Express session secret (already set) |

### Important (features degrade without these)
| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | Min 32-char key for encrypting CRM/LeadSquared credentials |
| `OPENAI_API_KEY` | OpenAI API access for chat/voice features |
| `COOKIE_SECRET` | Cookie signing secret (falls back to random on each boot) |
| `SUPERADMIN_USERNAME` | Override default admin username |
| `SUPERADMIN_PASSWORD` | Override default admin password |

### Optional / Feature-specific
| Variable | Description |
|----------|-------------|
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Cloudflare R2 file storage |
| `SENDGRID_API_KEY` | Email delivery |
| `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_TEMPLATE_ID` | WhatsApp/SMS via MSG91 |
| `GOOGLE_VISION_WAREHOUSE_CREDENTIALS` | Google Vision AI |
| `BACKUP_SECRET_TOKEN` | Remote backup endpoint auth |
| `APP_DOMAIN` | Public domain for webhook callbacks |

## Database

- Replit's built-in PostgreSQL is used (pgvector extension enabled)
- Schema is managed with Drizzle ORM — run `npm run db:push` after schema changes
- pgvector extension must be enabled before first `db:push` (already done)

## User Preferences

- Keep the existing project structure and stack
