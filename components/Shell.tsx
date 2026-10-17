import type { ReactNode } from "react";

import { ELECTION_ID } from "@/lib/election";

/*
 * Shell: ผิวหน้าหลัก + เส้นคอลัมน์ที่เปิดเผย (rails) + colophon (Ft2)
 * ใช้ห่อทุกหน้าของผู้ลงคะแนน — UI เท่านั้น
 */

export default function Shell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="hm-page">
      <div className="hm-shell">
        <div className="hm-rails" aria-hidden="true" />

        {children}

        <footer className="hm-foot">
          <span>BlockVote · Solana devnet</span>
          <span className="hm-tnum">
            การเลือกตั้ง #{ELECTION_ID}
          </span>
        </footer>
      </div>
    </div>
  );
}
