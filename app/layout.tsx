import type { Metadata, Viewport } from "next";
import "./globals.css";

// Global SEO Metadata settings
// 全局搜索引擎优化 (SEO) 元数据设置
export const metadata: Metadata = {
  title: "Polymarket Portfolio Analyzer",
  description: "Analyze Polymarket positions, Hold APR, ROI, and rebalancing signals for any EVM wallet.",
};

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark",
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
      <body className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100 antialiased">
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 opacity-0 shadow-lg transition-transform focus:translate-y-0 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Skip to main content / 跳转到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
