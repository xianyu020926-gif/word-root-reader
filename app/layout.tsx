import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "单点穿透词汇学习",
  description: "从文章语境出发，用词根结构集中学习英语词汇。",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
