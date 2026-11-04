"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconArrowRight } from "@/components/icons";

/*
 * Masthead (N9 · edge-aligned minimal)
 * wordmark ซ้ายสุด + ปุ่มเดียวขวาสุด — ปุ่มสลับตามหน้า
 * ถ้าส่ง wallet มา จะแสดงเป็นแถบ folio บาง ๆ ใต้ masthead
 */

export default function SiteNav({
  wallet,
  label = "กระเป๋า",
}: {
  wallet?: string | null;
  label?: string;
}) {
  const pathname = usePathname();

  const onBoard = pathname.startsWith("/scoreboard");

  const action = onBoard
    ? { href: "/vote", label: "ลงคะแนน" }
    : { href: "/scoreboard", label: "ผลคะแนน" };

  return (
    <>
      <header className="hm-mast">
        <Link
          href="/"
          className="hm-word"
          aria-label="BlockVote หน้าแรก"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/blockvote.png"
            alt=""
            width={32}
            height={32}
            className="hm-brand-img"
          />

          BlockVote
        </Link>

        <Link href={action.href} className="hm-action">
          {action.label}
          <IconArrowRight size={16} />
        </Link>
      </header>

      {wallet && (
        <div className="hm-folio">
          <span>{label}</span>

          <span
            className="hm-tnum"
            title={wallet}
          >
            {wallet.slice(0, 4)}…{wallet.slice(-4)}
          </span>
        </div>
      )}
    </>
  );
}
