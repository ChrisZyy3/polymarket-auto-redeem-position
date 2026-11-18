import test from 'node:test';
import assert from 'node:assert/strict';
import {sellQueueStatusLabel} from '../lib/sell-queue-status';
test('unchecked positions never show queued; labels distinguish review from real orders',()=>{
 assert.equal(sellQueueStatusLabel({selected:false,record:undefined,activePreview:null,language:'zh'}),'未选择');
 assert.equal(sellQueueStatusLabel({selected:true,record:undefined,activePreview:null,language:'zh'}),'待审核');
 assert.equal(sellQueueStatusLabel({selected:true,record:{status:'open',updatedAt:0},activePreview:null,language:'zh'}),'已挂单');
 assert.equal(sellQueueStatusLabel({selected:true,record:{status:'uncertain',updatedAt:0},activePreview:null,language:'zh'}),'待核对订单');
});
