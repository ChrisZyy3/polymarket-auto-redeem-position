import type {QueueRecord} from './manual-sell-queue';
import type {loadSellReview} from './sell-snapshot';
type Snapshot=Awaited<ReturnType<typeof loadSellReview>>;
export function sellQueueStatusLabel({selected,record,activePreview,language}:{selected:boolean;record:QueueRecord|undefined;activePreview:Snapshot|null;language:'zh'|'en'}):string{
 const en=language==='en',state=record?.status;
 if(state==='open')return en?'Open order':'已挂单';
 if(state==='partially_filled')return en?'Partially filled':'部分成交';
 if(state==='matched_pending')return en?'Matching pending':'撮合待确认';
 if(state==='filled')return en?'Filled':'已成交';
 if(state==='canceled')return en?'Canceled':'已取消';
 if(state==='expired')return en?'Expired':'已过期';
 if(state==='uncertain')return en?'Check order history':'待核对订单';
 if(!selected)return en?'Not selected':'未选择';
 if(state==='blocked')return en?'Blocked':'审核未通过';
 if(state==='signing')return en?'Signing':'待钱包签名';
 if(activePreview?.result.status==='review')return activePreview.checks.authorizationVerified&&activePreview.checks.marketStatus==='accepting'?(en?'Ready to sign':'待签名'):(en?'Authorization check':'待授权核实');
 if(state==='reviewing')return en?'Reviewing':'审核中';
 return en?'To review':'待审核';
}
