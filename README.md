# IMSC Official Site

Static website and coordination app for IMSC 2026.

## Structure

- `index.html` - public schedule/site.
- `coordination/` - coordinator login, paper claiming, scoring, coordination, and PDF access.
- `supabase/schema.sql` - main Supabase schema, views, RLS policies, storage bucket setup, and RPC functions.
- `supabase/add-paper-pdfs.sql` - PDF-related schema additions.
- `scripts/init-coordination-data.mjs` - seeds coordinators, teams, students, papers, and auth users.
- `scripts/upload-day1-pdfs.mjs` - uploads scanned PDFs to Supabase Storage and links them to papers.

## Local Development

Run a local static server:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:8765/
http://127.0.0.1:8765/coordination/
```

## Coordination App Config

Create the frontend config from the example:

```bash
cp coordination/config.example.js coordination/config.js
```

Fill in:

```js
window.COORDINATION_SUPABASE_CONFIG = {
  url: "https://your-project-ref.supabase.co",
  publishableKey: "your-publishable-or-anon-key",
  emailDomain: "imsc-coordination.local"
};
```

`coordination/config.js` is ignored by Git.

## Supabase Setup

Run `supabase/schema.sql` manually in the Supabase SQL editor.

The schema creates:

- coordinator/team/student/paper tables
- paper claims
- initial and agreed score history tables
- `paper_status` view used by the app
- RPC functions for claiming, scoring, releasing, avatar updates, and PDF access
- private `paper-pdfs` storage bucket

For live board updates, enable Realtime for:

```sql
alter publication supabase_realtime add table paper_claims;
alter publication supabase_realtime add table initial_score_history;
alter publication supabase_realtime add table agreed_score_history;
alter publication supabase_realtime add table papers;
```

Skip any statement that errors because the table is already in the publication.

## Seeding Data

Create local server-side credentials:

```bash
cp .env.example .env.local
```

Fill in:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
COORDINATION_PASSWORD_OUTPUT=coordination-passwords.csv
COORDINATION_RESET_PASSWORDS=false
```

Then run:

```bash
npm run coordination:init
```

This seeds:

- active coordinators from `index.html`
- teams and team codes
- students and papers
- Supabase auth users

Existing auth passwords are preserved unless:

```bash
COORDINATION_RESET_PASSWORDS=true npm run coordination:init
```

The generated `coordination-passwords.csv` is ignored by Git.

## Resetting Coordination State

To clear claims and scores before an event, delete only:

- `paper_claims`
- `initial_score_history`
- `agreed_score_history`

Then reset score fields on `papers`:

- `initial_score`
- `initial_score_coordinator_id`
- `agreed_score`
- `agreed_score_coordinator_id`
- `agreed_score_team_leader_signature`

Do not delete coordinators, teams, students, or papers unless rebuilding the event data.

## PDF Uploads

PDFs are stored in the private Supabase Storage bucket `paper-pdfs`.

The Day 1 upload script expects a directory shaped like:

```text
TEAM_CODE/
  001/
    p1.pdf
    p2.pdf
```

Dry run:

```bash
npm run coordination:upload-day1-pdfs -- --dry-run
```

Upload:

```bash
npm run coordination:upload-day1-pdfs -- /path/to/Day1_Scan
```

## Deployment

This repo is deployed as a GitHub Pages project site with custom domain:

```text
imsc.zilin.one
```

The root `CNAME` file contains the custom domain. GitHub Pages serves the static files directly from the repository.

## Secrets

Never commit:

- `.env.local`
- `coordination/config.js`
- generated password CSVs
- service role keys

Frontend config must use the publishable/anon key only. The service role key is only for local scripts and Supabase administration.
