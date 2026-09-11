import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://shiguang-todo-list.copper-ball-7290.chatgpt.site'),
  title: '拾光清单｜简洁待办管理',
  description: '添加、搜索、编辑并完成你的每日待办，让重要的事井然有序。',
  openGraph: {
    title: '拾光清单',
    description: '把重要的事，一件件完成',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '拾光清单',
    description: '把重要的事，一件件完成',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
