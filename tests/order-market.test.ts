import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOrderMarketMetadata,shortenTokenId} from '../lib/order-market';
const a='123456789123456789', b='998877665544332211',conditionId='0x'+'1'.repeat(64);
test('resolves an orphan order token to verified market and outcome',()=>{
 const item={question:'Maxwell pardon?',conditionId,slug:'maxwell-pardon',clobTokenIds:JSON.stringify([a,b]),outcomes:'["Yes","No"]'};
 assert.deepEqual(parseOrderMarketMetadata(b,[item]),{title:'Maxwell pardon?',outcome:'No',conditionId,slug:'maxwell-pardon'});
 assert.equal(parseOrderMarketMetadata('555',[item]),null);
 assert.equal(parseOrderMarketMetadata(b,[{...item,conditionId:'wrong'}]),null);
});
test('accepts array token IDs and falls back to shortened identifiers',()=>{
 const item={question:'Fed hike?',conditionId,clobTokenIds:[a,b],outcomes:['Yes','No']};
 assert.equal(parseOrderMarketMetadata(a,[item])?.outcome,'Yes');
 assert.equal(shortenTokenId('71144742975537017512904527392353107518472601816123'),'7114474297…2601816123'.slice(0,10)+'…'+ '71144742975537017512904527392353107518472601816123'.slice(-8));
});
