# Polymarket Dashboard MVP

这是基于 Next.js + shadcn/ui 的 Polymarket 持仓看板 MVP 分支。

## 快速开始

```bash
git checkout feat/dashboard-mvp
git pull origin feat/dashboard-mvp

# 初始化 Next.js (Recommended)
npx create-next-app@latest . --yes --tailwind --eslint --yes --app

# 安装核心依赖
npm install @tanstack/react-table lucide-react

# shadcn/ui 初始化 (后续可选)
npx shadcn@latest init
```

## 核心文件
- `app/api/positions/route.ts` — 输入地址返回带 APR/ROI 的数据
- `lib/apr.ts` & `lib/polymarket.ts` — 复用现有计算逻辑
- `app/page.tsx` — 主看板页面

MVP 目标：输入任意钱包地址 → 看到带排序表格的丰富数据。