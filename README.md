Here's the new `README.md` — replace everything in the file with this.

```markdown
# Voice-to-Ledger — Backend

Voice-first financial recordkeeping for Nigerian MSMEs. Traders speak transactions in English or Pidgin; AI extracts structured records into a digital ledger and financial profile — no typing, no accounting knowledge needed.

Built for TechCrush Buildathon 3.0 — Team Foundry.

## Tech Stack

- **Framework:** Next.js (App Router) + TypeScript
- **Database & Auth:** Supabase (PostgreSQL, Row Level Security)
- **AI extraction:** Gemini API
- **Validation:** Zod
- **Speech-to-text:** Server-side endpoint (not on-device)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Create a `.env.local` file in the project root:

```
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GEMINI_API_KEY=your_gemini_key
```

Never prefix these with `NEXT_PUBLIC_` — that exposes them to the browser.

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
  app/
    api/
      transactions/
        route.ts          → POST, GET   /api/transactions
        [id]/
          route.ts        → PATCH, DELETE   /api/transactions/:id
        parse/
          route.ts        → POST   /api/transactions/parse
      voice/
        transcribe/
          route.ts        → POST   /api/voice/transcribe
      dashboard/
        route.ts          → GET   /api/dashboard
      financial-profile/
        route.ts          → GET   /api/financial-profile
        export/
          route.ts        → GET   /api/financial-profile/export
      businesses/
        route.ts          → POST   /api/businesses
```

## Core Flow

```
User speaks → /api/voice/transcribe → text
           → /api/transactions/parse → structured data (not saved)
           → user confirms on frontend
           → /api/transactions (POST) → saved to database
```

The AI never saves a transaction directly. Every transaction is shown to the user for confirmation before it's written to the database.

## API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/businesses` | POST | Create a business profile |
| `/api/voice/transcribe` | POST | Audio → text |
| `/api/transactions/parse` | POST | Text → structured transaction (preview only, not saved) |
| `/api/transactions` | POST | Save a confirmed transaction |
| `/api/transactions` | GET | List transactions for a business |
| `/api/transactions/:id` | PATCH | Edit a transaction |
| `/api/transactions/:id` | DELETE | Delete a transaction |
| `/api/dashboard` | GET | Sales, purchases, expenses, estimated profit |
| `/api/financial-profile` | GET | Business Financial Profile summary |
| `/api/financial-profile/export` | GET | Export profile (CSV/PDF) |

## Team

Backend: Emmanuel 