import { NextRequest, NextResponse } from 'next/server';
import { fetchCurrentPositions } from '@/lib/polymarket';
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
    const allPositions = await fetchCurrentPositions(address);

    const holding = allPositions.filter(p => !p.redeemable);
    const redeemable = allPositions.filter(p => p.redeemable);

    const enrichedHolding: EnrichedPosition[] = holding.map(p => {
      const result = calcApr(p);
      const status = isLosing(result, 0.5) ? 'losing' : needsAttention(result, aprThreshold) ? 'attention' : 'good';
      return {
        ...p,
        roi: result.roi,
        apr: result.apr,
        daysToSettle: result.daysToSettle,
        status,
        expectedProfit: p.size * result.roi,
        note: result.note,
      };
    });

    const enrichedRedeemable: EnrichedPosition[] = redeemable.map(p => ({
      ...p,
      roi: 0,
      apr: null,
      daysToSettle: 0,
      status: 'redeemable' as const,
      expectedProfit: 0,
    }));

    const allEnriched = [...enrichedHolding, ...enrichedRedeemable];

    // 简单汇总
    const summary = {
      totalPositions: allEnriched.length,
      totalSize: allEnriched.reduce((sum, p) => sum + p.size, 0),
      avgApr: enrichedHolding.length > 0 
        ? enrichedHolding.reduce((sum, p) => sum + (p.apr || 0), 0) / enrichedHolding.length 
        : 0,
      attentionCount: enrichedHolding.filter(p => p.status === 'attention').length,
      losingCount: enrichedHolding.filter(p => p.status === 'losing').length,
      redeemableCount: enrichedRedeemable.length,
    };

    return NextResponse.json({ summary, positions: allEnriched });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}
