import test from 'node:test';
import assert from 'node:assert/strict';
import {groupOpenOrders} from '../lib/open-order-groups';
import type {ClobOrder} from '../lib/browser-clob';
import type {EnrichedPosition} from '../lib/types';
const conditionId='0x'+'a'.repeat(64);
function order(id:string,asset:string,side:'BUY'|'SELL'):ClobOrder{return {id,asset_id:asset,side,maker_address:'0x'+'1'.repeat(40),status:'LIVE',price:'0.99',original_size:'100',size_matched:'40'};}
test('groups BUY/SELL by one condition; orphan Gamma metadata resolves title and outcome',()=>{
 const orders=[order('a','123','BUY'),order('b','123','SELL'),order('c','456','BUY')];
 const held=[{asset:'123',title:'Fed decision?',outcome:'No',conditionId,slug:'fed-hike',eventSlug:'fed-hike'}] as EnrichedPosition[];
 const groups=groupOpenOrders(orders,held,{'456':{title:'Maxwell pardon?',outcome:'No',conditionId:'0x'+'b'.repeat(64),slug:'maxwell'}});
 assert.equal(groups.length,2);
 assert.equal(groups[0].items.length,2);assert.equal(groups[0].title,'Fed decision?');
 assert.equal(groups[1].items[0].outcome,'No');assert.equal(groups[1].title,'Maxwell pardon?');
});
test('unknown token is abbreviated and never misattributed',()=>{
 const [g]=groupOpenOrders([order('x','12345678900000123456789','SELL')],[],{});
 assert.equal(g.title,'Unidentified market');assert.match(g.items[0].tokenLabel,/…/);
});
