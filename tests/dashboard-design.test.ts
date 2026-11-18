import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('dashboard uses one visual language and a reduced-motion fallback',()=>{
 const page=readFileSync('app/page.tsx','utf8');
 const css=readFileSync('app/globals.css','utf8');
 const wallet=readFileSync('app/components/wallet-connect-panel.tsx','utf8');
 const review=readFileSync('app/components/manual-sell-review.tsx','utf8');
 for(const name of ['ui-hero','ui-surface','ui-stat-card','ui-table','ui-button-primary','ui-segmented'])
  assert.ok(page.includes(name),name);
 assert.ok(css.includes('prefers-reduced-motion: reduce'));
 assert.ok(css.includes('ui-dialog')&&css.includes('ui-button-trade'));
 assert.ok(wallet.includes('ui-surface'));
 assert.ok(review.includes('ui-dialog')&&review.includes('ui-progress-rail'));
});
test('CLOB authentication explains gas-free signing without altering the reader',()=>{
 const source=readFileSync('app/components/browser-clob-panel.tsx','utf8');
 assert.match(source,/ClobAuth/);
 assert.match(source,/deriveClobCredentials/);
 assert.match(source,/fetchBrowserOpenOrders/);
 assert.match(source,/连接 CLOB · 签名认证/);
 assert.match(source,/已认证 · 仅当前页面/);
 assert.match(source,/刷新挂单/);
});
