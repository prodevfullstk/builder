const { Client } = require('pg');
const fs = require('fs');

async function applyMigration() {
  let sql = fs.readFileSync('supabase/migrations/20260913_fix_tenant_isolation_rls.sql', 'utf8');
  sql = sql.replace(/^\uFEFF/, '').trim();

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected to database, executing migration...');
  await client.query(sql);
  console.log('Migration executed successfully!');

  // Verify new policies
  const policies = await client.query(`
    SELECT policyname, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE tablename = 'projects';
  `);
  console.log('Active policies on public.projects:');
  policies.rows.forEach(p => console.log(' -', p.policyname, '| cmd:', p.cmd, '| roles:', p.roles));

  await client.end();
}

applyMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
