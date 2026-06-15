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
        {/*
          * Background decoration glowing blobs (Magic UI style gradient backdrops)
          * 背景霓虹发光斑点装饰，利用高斯模糊与半透明渐变色提供高端的暗色科技质感
          */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-900/10 blur-[120px] pointer-events-none animate-pulse-slow"></div>
        <div className="absolute bottom-[20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-purple-900/10 blur-[150px] pointer-events-none animate-pulse-slow"></div>
        
        {/* Main content viewport / 主内容渲染视口 */}
        {children}
      </body>
    </html>
  );
}
