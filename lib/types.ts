export interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string | null;
  negativeRisk: boolean;
}

export interface EnrichedPosition extends Position {
  holdRoi: number;
  costRoi: number;
  holdApr: number | null; // Combined Mark APR + Holding Rewards APR
  markApr: number | null;
  holdingRewardApr: number;
  holdingRewardEligible: boolean | null;
  costApr: number | null;
  daysToSettle: number;
  status: 'good' | 'attention' | 'losing' | 'redeemable';
  expectedProfit: number;
  note?: string;
}
