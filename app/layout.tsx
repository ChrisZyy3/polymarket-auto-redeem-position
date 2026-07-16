import type { Metadata } from "next";
import "./globals.css";

// Global SEO Metadata settings
// 全局搜索引擎优化 (SEO) 元数据设置
export const metadata: Metadata = {
  title: "Polymarket 持仓监控与收益率分析看板",
  description: "输入 EVM 钱包地址实时计算并查看 Polymarket 持仓的预期收益率 APR / ROI 以及调仓提醒",
};

/**
 * Root layout component containing the main HTML layout and styling wrappers.
 * 全局根布局组件，设定了页面基础语言、深色背景背景颜色以及字体平滑属性
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen relative overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
