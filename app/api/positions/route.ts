import { NextRequest, NextResponse } from 'next/server';
import { fetchCurrentPositions, fetchCashBalance } from '@/lib/polymarket';
import { calcApr, needsAttention, isLosing } from '@/lib/apr';
import type { EnrichedPosition } from '@/lib/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');
  const aprThreshold = parseFloat(searchParams.get('aprThreshold') || '8');
  const minSize = parseFloat(searchParams.get('minSize') || '0.1');

  if (!address) {
    return NextResponse.json({ error: 'Missing address' }, { status: 400 });
  }

  try {
    const [allPositions, availableBalance] = await Promise.all([
      fetchCurrentPositions(address),
      fetchCashBalance(address).catch(() => 0),
    ]);

    const holding = allPositions.filter(p => !p.redeemable);
    const redeemable = allPositions.filter(p => p.redeemable);

    const enrichedHolding: EnrichedPosition[] = holding.map(p => {
      const result = calcApr(p);
      const status = isLosing(result, 0.5) ? 'losing' : needsAttention(result, aprThreshold) ? 'attention' : 'good';
      return {
        ...p,
        holdRoi: result.holdRoi,
        costRoi: result.costRoi,
        holdApr: result.holdApr,
        costApr: result.costApr,
        daysToSettle: result.daysToSettle,
        status,
        expectedProfit: p.size * result.holdRoi,
        note: result.note,
      };
    });

    const enrichedRedeemable: EnrichedPosition[] = redeemable.map(p => ({
      ...p,
      holdRoi: 0,
      costRoi: 0,
      holdApr: null,
      costApr: null,
      daysToSettle: 0,
      status: 'redeemable' as const,
      expectedProfit: 0,
    }));

    const allEnriched = [...enrichedHolding, ...enrichedRedeemable];

    // 按当前仓位价值加权，避免小仓位的极端 APR 拉偏整体均值
    const totalHoldingValue = enrichedHolding.reduce((sum, p) => sum + p.currentValue, 0);
    const weightedAvg = (pick: (p: EnrichedPosition) => number | null) =>
      totalHoldingValue > 0
        ? enrichedHolding.reduce((sum, p) => sum + (pick(p) || 0) * p.currentValue, 0) / totalHoldingValue
        : 0;

    const totalValue = allEnriched.reduce((sum, p) => sum + p.currentValue, 0);

    const summary = {
      totalPositions: allEnriched.length,
      totalValue,
      totalBalance: totalValue + availableBalance,
      availableBalance,
      avgHoldApr: weightedAvg(p => p.holdApr),
      avgCostApr: weightedAvg(p => p.costApr),
    };

    return NextResponse.json({ summary, positions: allEnriched });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}
