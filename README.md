# Trebal API (Render-ready)
This repo contains:
- Constitution core rules (Steps 1-7 subset starter)
- Express API
- Prisma Postgres schema
- Append-only audit log

Local run:
1) npm install
2) copy .env.example to .env and set DATABASE_URL, JWT_SECRET, PASSWORD_PEPPER
3) npx prisma db push
4) node prisma/seed.js
5) npm run dev
