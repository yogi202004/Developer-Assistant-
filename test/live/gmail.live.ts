// OPTIONAL live check against your real Gmail (read-only search, limit 1). Never sends anything.
// Run: npm run test:live   (requires `npm run gmail:auth` to have been completed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../fakes';
import { realDeps } from '../../src/mcp/deps';
import { gmailConfigured } from '../../src/integrations/gmail';

test('gmail_search_emails works through the real integration', { skip: !gmailConfigured() && 'Gmail not configured (run npm run gmail:auth)' }, async () => {
  const { call, close } = await connect(realDeps());
  const r = await call('gmail_search_emails', { query: 'in:inbox', limit: 1 });
  assert.equal(r.isError, false, r.text);
  assert.equal(typeof r.data.count, 'number');
  await close();
});
