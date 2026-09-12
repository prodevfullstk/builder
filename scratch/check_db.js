const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkDb() {
  await client.connect();
  console.log('Connected to Supabase PostgreSQL!');

  // Check columns on public.projects
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'projects' AND table_schema = 'public'
    ORDER BY ordinal_position;
  `);
  console.log('Columns on public.projects:', cols.rows);

  // Check RLS status on public.projects
  const rls = await client.query(`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname = 'projects';
  `);
  console.log('RLS status on public.projects:', rls.rows);

  // Check policies on public.projects
  const policies = await client.query(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE tablename = 'projects';
  `);
  console.log('Policies on public.projects:', policies.rows);

  // Also check if there are other tables in public schema
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public';
  `);
  console.log('All public tables:', tables.rows.map(r => r.table_name));

  await client.end();
}
checkDb().catch(err => {
  console.error('DB error:', err.message);
  client.end().catch(() => {});
});
