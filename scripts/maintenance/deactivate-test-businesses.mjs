// Hide test/demo businesses from the live platform (soft delete).
//   Dry run:  node --env-file=.env.local scripts/maintenance/deactivate-test-businesses.mjs
//   Apply:    node --env-file=.env.local scripts/maintenance/deactivate-test-businesses.mjs --apply
// Rules: only slugs in the explicit list below are touched. Each is set to
// status DEACTIVATED, active=false, and its slug gets a "-removed" suffix so the
// clean slug is free again. Nothing is hard-deleted.
import { PrismaClient } from '@prisma/client';
const APPLY = process.argv.includes('--apply');
const SLUGS = [
  'kota-tainment',                       // old test store, owner nmeyiswa+test@gmail.com (Gumede creates his own)
  'login-bug-test-shop', 'payment-test-tuck-shop', 'mzansi-bites-onboarding-test', 'test-kota-kitchen-04',
  'storefront-business-info-test-persist', 'storefront-business-info-test-preserve-settings', 'storefront-business-info-test-no-branding',
  'storefront-business-info-test-persist-gzvz', 'storefront-business-info-test-preserve-settings-967i', 'storefront-business-info-test-no-branding-vcno',
  'storefront-business-info-test-persist-tfnq', 'storefront-business-info-test-preserve-settings-78vb', 'storefront-business-info-test-no-branding-woqb',
  'order-test-no-inventory-record', 'order-test-real-inventory', 'order-test-idempotency-fresh', 'order-test-idempotency-sequential-retry',
  'order-test-idempotency-concurrent', 'order-test-idempotency-cross-biz-a', 'order-test-idempotency-cross-biz-b', 'order-test-idempotency-different-key',
  'order-test-option-snapshot-basic', 'order-test-option-snapshot-none', 'order-test-option-snapshot-multi-item', 'order-test-option-snapshot-survives-changes',
];
// Use the direct (non-pooled) connection with a generous timeout: the Neon compute
// may be asleep and the pooled URL gives up after 10 s.
const direct = process.env.POSTGRES_URL_NON_POOLING || process.env.DIRECT_URL || process.env.POSTGRES_PRISMA_URL;
const url = direct.includes('connect_timeout') ? direct : `${direct}${direct.includes('?') ? '&' : '?'}connect_timeout=60&pool_timeout=60`;
const p = new PrismaClient({ datasources: { db: { url } } });
const rows = await p.business.findMany({ where: { slug: { in: SLUGS } }, select: { id: true, name: true, slug: true, status: true, active: true, email: true } });
console.log(`${rows.length} of ${SLUGS.length} listed slugs found. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
for (const r of rows) {
  const newSlug = `${r.slug}-removed`;
  console.log(`${APPLY ? 'deactivating' : 'would deactivate'}: ${r.name} | ${r.slug} -> ${newSlug} | ${r.status} | ${r.email ?? '-'}`);
  if (APPLY) {
    await p.business.update({ where: { id: r.id }, data: { status: 'DEACTIVATED', active: false, slug: newSlug, name: r.name.endsWith(' (removed)') ? r.name : `${r.name} (removed)` } });
  }
}
const missing = SLUGS.filter(s => !rows.some(r => r.slug === s));
if (missing.length) console.log('not found (already renamed?):', missing.join(', '));
const live = await p.business.findMany({ where: { status: 'ACTIVE' }, select: { name: true, slug: true } });
console.log('ACTIVE businesses after this run:', live.map(b => `${b.name} (${b.slug})`).join('; '));
await p.$disconnect();
