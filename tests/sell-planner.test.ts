import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPositionQuote } from '../lib/position-quote';
import { makerSellSuggestion } from '../lib/sell-planner';
const quote = (ask='0.995',bid='0.980',tick='0.001') => buildPositionQuote({currentPrice:0.98,endDate:'2026-01-31',thresholdAprPercent:12,now:new Date('2026-01-01T00:00:00Z'),orderBook:{asks:ask?[{price:ask,size:'100'}]:[],bids:bid?[{price:bid,size:'100'}]:[],tick_size:tick}});
test('maker suggestion uses the higher of the target and best ask',()=>{
 assert.equal(makerSellSuggestion(quote(),12,100,0.9).price,0.995);
 assert.equal(makerSellSuggestion(quote('0.985'),12,100,0.9).price,0.990);
});
test('missing, invalid or crossing data cannot produce a suggestion',()=>{
 assert.equal(makerSellSuggestion(quote('', '0.980'),12,100,0.9).price,null);
 assert.equal(makerSellSuggestion(quote('0.990','0.995'),12,100,0.9).price,null);
 assert.equal(makerSellSuggestion(quote('0.995','0.980','bad'),12,100,0.9).price,null);
 assert.equal(makerSellSuggestion(quote(),0,100,0.9).price,null);
 assert.equal(makerSellSuggestion(null,12,100,0.9).price,null);
});
