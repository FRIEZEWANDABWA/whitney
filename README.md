# EntryJobs KE — AI Entry-Level Job Intelligence System (Kenya)..

Scrapes Kenyan job boards, NGO/UN/bank career pages and recruitment agencies for
**internships, graduate trainee programmes, apprenticeships/attachments, and any
entry-level role requiring 0-1 years of experience — across all industries**, then
uses OpenAI embeddings + a rule-based scorer to match postings against your CV and
notify you (email/Telegram) of strong matches.

This is a sibling project of the original JobHunterAI IT-executive system, rebuilt
with the same architecture (Next.js + Supabase + GitHub Actions cron) but a
completely different scoring target. See `deployment_guide.md` for setup and
`seed_entry_sources.sql` for the starter job sources.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
