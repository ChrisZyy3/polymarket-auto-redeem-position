import test from 'node:test';
import assert from 'node:assert/strict';
import {CTF_STANDARD_EXCHANGE,CTF_NEG_RISK_EXCHANGE,getV1SellApprovalTarget,classifySellApproval} from '../lib/clob-sell-approval';
const asset='71144742975537017512904527392353107518472601816123355990566837993879064231255',conditionId='0x'+'a'.repeat(64);
const market=(negRisk:boolean)=>({condition_id:conditionId,neg_risk:negRisk,tokens:[{token_id:asset,outcome:'No'}]});
test('selects exact standard versus neg-risk CTF exchange; wrong asset/condition fails closed',()=>{
 assert.equal(getV1SellApprovalTarget(asset,conditionId,market(false))?.operator,CTF_STANDARD_EXCHANGE);
 assert.equal(getV1SellApprovalTarget(asset,conditionId,market(true))?.operator,CTF_NEG_RISK_EXCHANGE);
 assert.equal(getV1SellApprovalTarget(asset,'0x'+'b'.repeat(64),market(true)),null);
 assert.equal(getV1SellApprovalTarget('100',conditionId,market(false)),null);
 assert.equal(getV1SellApprovalTarget(asset,conditionId,{...market(true),neg_risk:undefined}),null);
});
test('requires onchain true and matching CLOB operator with sufficient raw shares',()=>{
 const allowances={[CTF_NEG_RISK_EXCHANGE]:'20000000'};
 assert.equal(classifySellApproval({operator:CTF_NEG_RISK_EXCHANGE,allowances,requestedShares:11,onchain:true}),'approved');
 assert.equal(classifySellApproval({operator:CTF_STANDARD_EXCHANGE,allowances,requestedShares:11,onchain:true}),'unknown');
 assert.equal(classifySellApproval({operator:CTF_NEG_RISK_EXCHANGE,allowances,requestedShares:11,onchain:false}),'missing');
 assert.equal(classifySellApproval({operator:CTF_NEG_RISK_EXCHANGE,allowances,requestedShares:21,onchain:true}),'unknown');
 assert.equal(classifySellApproval({operator:CTF_NEG_RISK_EXCHANGE,allowances,requestedShares:11,onchain:null}),'unknown');
});
