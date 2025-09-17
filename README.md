# Vercel Overlay (Serverless API + Prisma)

This overlay adds Vercel-ready `/api` serverless functions, `/lib` helpers, and a Prisma schema for Postgres.

## Steps

1. Unzip into the root of your current project (next to your `client/` folder).
2. Provision a Postgres DB (Neon or Supabase) and set `DATABASE_URL` in Vercel.
3. Also set `YOUTUBE_API_KEY` in Vercel for YouTube search.
4. Deploy on Vercel. The API endpoints will be available under `/api/*`.

## Endpoints
- `POST /api/research/run`
- `GET  /api/themes/top`
- `GET  /api/briefs/pdf`
- `GET/POST/PATCH/DELETE /api/research/watchlist`