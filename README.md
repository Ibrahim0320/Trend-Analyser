# AI Trend Dashboard — MVP Scaffold

## Run locally
### Server
```
cd server
npm i
npm run start
```
### Client
```
cd client
npm i
npm run dev
```
Set `VITE_API_URL=http://localhost:4000` for the client to point at the server.

## Endpoints
- POST /api/trends/upload  (multipart/form-data: file=CSV)
- GET  /api/trends/top?type=hashtag|color|item&region=Nordics|FR&week=YYYY-Www&limit=20
- GET  /api/trends/timeseries?entity=%23trenchcoat&type=hashtag&region=Nordics&weeks=8
- GET  /api/trends/cooccur?left=items&right=colors&region=Nordics&week=YYYY-Www
- GET  /api/creators/top?entity=%23loafers&region=Nordics&week=YYYY-Www
- POST /api/trends/summary/generate
- GET  /api/trends/summary/latest?region=Nordics

SQLite file: `server/trends.sqlite` (auto-created).
