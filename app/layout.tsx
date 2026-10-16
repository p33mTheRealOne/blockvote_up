import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockVote",
  description: "Secure blockchain voting powered by Solana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}