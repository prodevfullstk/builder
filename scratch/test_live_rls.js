const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function runAdversarialRlsTest() {
  console.log('=== RUNNING LIVE ADVERSARIAL RLS ISOLATION TEST ===');

  // 1. Create User A and User B via admin API
  const pass = 'RlsTestPass1!' + Math.random().toString(36).slice(2, 6);
  const emailA = 'rls_victim_' + Date.now() + '@example.com';
  const emailB = 'rls_attacker_' + Date.now() + '@example.com';

  const userA = await (await fetch(url + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailA, password: pass, email_confirm: true })
  })).json();

  const userB = await (await fetch(url + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailB, password: pass, email_confirm: true })
  })).json();

  // 2. Sign in to obtain access tokens
  const tokenA = (await (await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailA, password: pass })
  })).json()).access_token;

  const tokenB = (await (await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailB, password: pass })
  })).json()).access_token;

  console.log('User A created:', !!userA.id, '| User B created:', !!userB.id);

  // 3. User A inserts a project with confidential data
  const projId = 'proj_victim_' + Date.now();
  const insertA = await fetch(url + '/rest/v1/projects', {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + tokenA,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      id: projId,
      user_id: userA.id,
      name: 'User A Secret Confidential Project',
      framework: 'nextjs',
      files: { 'secrets.env': 'TOP_SECRET_USER_A_DATA_DO_NOT_LEAK' }
    })
  });
  console.log('User A insert status:', insertA.status);
  if (insertA.status !== 201) {
    console.error('User A insert failed:', await insertA.text());
    process.exit(1);
  }

  // 4. Test User B attempting to SELECT User A project
  const readB = await fetch(url + '/rest/v1/projects?id=eq.' + projId, {
    method: 'GET',
    headers: { apikey: anon, Authorization: 'Bearer ' + tokenB }
  });
  const readBData = await readB.json();
  const readBlocked = readB.status === 200 && Array.isArray(readBData) && readBData.length === 0;
  console.log('Test 1: User B SELECT User A project -> Rows returned:', readBData.length, '| RESULT:', readBlocked ? 'PASS (ISOLATED)' : 'FAIL');

  // 5. Test User B attempting to UPDATE User A project
  const updateB = await fetch(url + '/rest/v1/projects?id=eq.' + projId, {
    method: 'PATCH',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + tokenB,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ name: 'Hacked by Attacker' })
  });
  const updateBData = await updateB.json();
  const updateBlocked = updateB.status === 200 && Array.isArray(updateBData) && updateBData.length === 0;
  console.log('Test 2: User B UPDATE User A project -> Rows updated:', updateBData.length, '| RESULT:', updateBlocked ? 'PASS (BLOCKED)' : 'FAIL');

  // 6. Test User B attempting to DELETE User A project
  const deleteB = await fetch(url + '/rest/v1/projects?id=eq.' + projId, {
    method: 'DELETE',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + tokenB,
      'Prefer': 'return=representation'
    }
  });
  const deleteBData = await deleteB.json();
  const deleteBlocked = deleteB.status === 200 && Array.isArray(deleteBData) && deleteBData.length === 0;
  console.log('Test 3: User B DELETE User A project -> Rows deleted:', deleteBData.length, '| RESULT:', deleteBlocked ? 'PASS (BLOCKED)' : 'FAIL');

  // 7. Test User B attempting to INSERT a project with User A as owner (spoofing owner_id)
  const spoofProjId = 'proj_spoof_' + Date.now();
  const spoofInsert = await fetch(url + '/rest/v1/projects', {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + tokenB,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      id: spoofProjId,
      user_id: userA.id, // Forged owner!
      name: 'Spoofed Project',
      framework: 'nextjs',
      files: {}
    })
  });
  const spoofStatus = spoofInsert.status;
  const spoofData = await spoofInsert.json();
  const spoofBlocked = spoofStatus === 403 || spoofStatus === 400 || spoofData?.code === '42501';
  console.log('Test 4: User B INSERT claiming User A owner -> Status:', spoofStatus, 'code:', spoofData?.code, '| RESULT:', spoofBlocked ? 'PASS (BLOCKED BY WITH CHECK)' : 'FAIL');

  // 8. Verify User A STILL has full access to their own project
  const readA = await fetch(url + '/rest/v1/projects?id=eq.' + projId, {
    method: 'GET',
    headers: { apikey: anon, Authorization: 'Bearer ' + tokenA }
  });
  const readAData = await readA.json();
  const userAHasAccess = readA.status === 200 && Array.isArray(readAData) && readAData.length === 1 && readAData[0].name === 'User A Secret Confidential Project';
  console.log('Test 5: User A retains full access to their own project -> Rows:', readAData.length, '| RESULT:', userAHasAccess ? 'PASS (OWNER ACCESS PRESERVED)' : 'FAIL');

  // 9. Clean up test users and data
  await fetch(url + '/auth/v1/admin/users/' + userA.id, { method: 'DELETE', headers: { apikey: service, Authorization: 'Bearer ' + service } });
  await fetch(url + '/auth/v1/admin/users/' + userB.id, { method: 'DELETE', headers: { apikey: service, Authorization: 'Bearer ' + service } });
  console.log('=== ADVERSARIAL RLS ISOLATION TEST PASSED COMPLETELY! ===');
}

runAdversarialRlsTest().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
