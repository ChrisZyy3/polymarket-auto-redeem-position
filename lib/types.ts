export interface Position {
  title: string;
  outcome: string;
  size: number;
  curPrice: number;
  endDate?: string;
  redeemable: boolean;
  // 根据实际 API 补充其他字段
  [key: string]: any;
}

export interface EnrichedPosition extends Position {
  roi: number;
  apr: number | null;
  daysToSettle: number;
  status: 'good' | 'attention' | 'losing' | 'redeemable';
  expectedProfit: number;
  note?: string;
}
