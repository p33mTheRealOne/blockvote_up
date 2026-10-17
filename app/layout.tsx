import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

/* Archivo: ตัวอักษรละติน + ตัวเลข / IBM Plex Sans Thai: ครอบคลุมอักษรไทย */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-archivo",
});

const plexThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-thai",
});

export const metadata: Metadata = {
  icons: { icon: "/blockvote.png" },
  title: {
    default: "BlockVote",
    template: "%s · BlockVote",
  },
  description:
    "ระบบเลือกตั้งบนบล็อกเชน Solana — ลงคะแนนให้จบในไม่กี่ขั้นตอน และตรวจผลได้เอง",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f9fafc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${archivo.variable} ${plexThai.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
