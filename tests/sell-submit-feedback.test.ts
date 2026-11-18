import test from 'node:test';
import assert from 'node:assert/strict';
import {sellSubmitProgress,shouldAutoRecheckSell,sellBlockReasonText} from '../lib/sell-submit-feedback';
test('five order stages distinguish wallet signature from actual CLOB verification',()=>{
 const phases=['precheck','wallet','postcheck','posting','readback'] as const;
 assert.deepEqual(phases.map(p=>sellSubmitProgress(p,'zh').step),[1,2,3,4,5]);
 assert.match(sellSubmitProgress('wallet','zh').title,/钱包/);
 assert.match(sellSubmitProgress('readback','zh').hint,/LIVE/);
});
test('successful order readback cannot automatically reopen invalid-quantity preflight',()=>{
 const base={active:true,hasReview:true,busy:false,locked:false,ordersReady:true,pending:false,uncertain:false,configChanged:true};
 assert.equal(shouldAutoRecheckSell(base),true);
 assert.equal(shouldAutoRecheckSell({...base,hasReview:false}),false);
 assert.equal(shouldAutoRecheckSell({...base,locked:true}),false);
 assert.equal(shouldAutoRecheckSell({...base,pending:true}),false);
 assert.equal(shouldAutoRecheckSell({...base,ordersReady:false}),false);
});
test('invalid quantity explains possible existing order rather than exposing raw error code',()=>{
 const s=sellBlockReasonText('invalid_quantity','zh');
 assert.match(s,/最小下单量/);assert.match(s,/已有 SELL/);
 assert.equal(sellBlockReasonText('market_paused','zh'),'market_paused');
});
