import { NextRequest, NextResponse } from 'next/server';
import { fetchCurrentPositions, fetchCashBalance, filterPositionsByMinimumValue } from '@/lib/polymarket';
import { calcApr, needsAttention, isLosing } from '@/lib/apr';
import type { EnrichedPosition } from '@/lib/types';
import { holdingRewardForSlug, combinedHoldingApr } from '@/lib/holding-rewards';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');
  const aprThreshold = parseFloat(searchParams.get('aprThreshold') || '8');
  const minSize = parseFloat(searchParams.get('minSize') || '0.1');
  const minValue = parseFloat(searchParams.get('minValue') || '1');

  if (!address) {
    return NextResponse.json({ error: 'Missing address' }, { status: 400 });
  }

  try {
    const [allPositions, availableBalance] = await Promise.all([
      fetchCurrentPositions(address, Number.isFinite(minSize) && minSize >= 0 ? minSize : 0.1),
      fetchCashBalance(address).catch(() => 0),
    ]);

    const minimumValue = Number.isFinite(minValue) && minValue >= 0 ? minValue : 1;
    const visiblePositions = filterPositionsByMinimumValue(allPositions, minimumValue);
    const holding = visiblePositions.filter(p => !p.redeemable);
    const redeemable = visiblePositions.filter(p => p.redeemable);

    const uniqueSlugs = [...new Set(holding.map(p => p.eventSlug || p.slug).filter(Boolean))];
    const rewards = new Map(await Promise.all(uniqueSlugs.map(async slug =>
      [slug, await holdingRewardForSlug(slug, fetch, undefined, holding.find(p => (p.eventSlug || p.slug) === slug)?.conditionId)] as const
    )));
    const enrichedHolding: EnrichedPosition[] = holding.map(p => {
      const result = calcApr(p);
      const reward = rewards.get(p.eventSlug || p.slug) ?? { eligible:null, apr:0 };
      const effectiveHoldApr = combinedHoldingApr(result.holdApr, reward.apr);
      const hasCurrentLoss = Number.isFinite(p.cashPnl) && p.cashPnl < 0;
      const status = hasCurrentLoss || isLosing(result, 0.5)
        ? 'losing'
        : (effectiveHoldApr === null || effectiveHoldApr * 100 < aprThreshold)
          ? 'attention'
          : 'good';
      return {
        ...p,
        holdRoi: result.holdRoi,
        costRoi: result.costRoi,
        markApr: result.holdApr,
        holdingRewardApr: reward.apr,
        holdingRewardEligible: reward.eligible,
        holdApr: effectiveHoldApr,
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
      markApr: null,
      holdingRewardApr: 0,
      holdingRewardEligible: null,
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

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      summary,
      positions: allEnriched,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}
