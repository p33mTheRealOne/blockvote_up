"use client";

import type { ReactNode } from "react";

import { useElectionId } from "@/lib/use-election-id";

/*
 * Shell: ผิวหน้าหลัก + เส้นคอลัมน์ที่เปิดเผย (rails) + colophon (Ft2)
 * ใช้ห่อทุกหน้าของผู้ลงคะแนน — UI เท่านั้น
 */

export default function Shell({
  children,
}: {
  children: ReactNode;
}) {
  const { electionId } = useElectionId();

  return (
    <div className="hm-page">
      <div className="hm-shell">
        <div className="hm-rails" aria-hidden="true" />

        {children}

        <footer className="hm-foot">
          <span>BlockVote · Solana devnet</span>
          <span className="hm-tnum">
            การเลือกตั้ง #{electionId ?? "–"}
          </span>
        </footer>
      </div>
    </div>
  );
}
