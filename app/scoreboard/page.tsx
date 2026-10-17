"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { ELECTION_ID } from "@/lib/election";
import { fetchScoreboard } from "@/lib/reveal";

import SiteNav from "@/components/SiteNav";
import Shell from "@/components/Shell";
import {
  IconArrowLeft,
  IconRefresh,
} from "@/components/icons";

type Board = NonNullable<Awaited<ReturnType<typeof fetchScoreboard>>>;

function formatTime(unix: number) {
  return new Date(unix * 1000).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/* ---------- Party logo (fallback เป็นตัวอักษรแรก) ---------- */

function Logo({ name, url }: { name: string; url: string }) {
  const [failed, setFailed] = useState(!url);

  if (failed) {
    return (
      <span className="hm-logo" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`${name} logo`}
      width={40}
      height={40}
      className="hm-logo"
      onError={() => setFailed(true)}
    />
  );
}

/* ---------- Page (Stat-Led) ---------- */

export default function ScoreboardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");

    fetchScoreboard(ELECTION_ID)
      .then((result) => {
        if (cancelled) return;

        if (!result) {
          setBoard(null);
          setError(`ไม่พบ Election ${ELECTION_ID} บนเชน`);
        } else {
          setBoard(result);
          setUpdatedAt(new Date());
        }
      })
      .catch((err) => {
        console.error("scoreboard error:", err);

        if (!cancelled) {
          setError("ไม่สามารถอ่านข้อมูลจาก Solana ได้");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const result = board?.result ?? null;
  const total = result?.totalVotes ?? 0;
  const topVotes = board?.rows[0]?.votes ?? 0;

  const status = !board
    ? ""
    : result
      ? "เปิดเผยผลแล้ว"
      : board.election.ended
        ? "รอผู้ดูแลเปิดเผยผล"
        : "การเลือกตั้งยังไม่สิ้นสุด";

  return (
    <>
      <SiteNav />

      <Shell>
        <main className="hm-main">

          {/* ---------- Loading ---------- */}

          {loading && !board && (
            <p className="hm-wait" role="status">
              <Loader2 className="animate-spin" size={18} />
              กำลังอ่านผลคะแนนจากเชน…
            </p>
          )}

          {/* ---------- Error ---------- */}

          {error && (
            <div className="hm-note hm-note--error" role="alert">
              <p>
                <strong>อ่านผลคะแนนไม่สำเร็จ</strong>
              </p>

              <p>{error}</p>
            </div>
          )}

          {board && (
            <>
              {/* ---------- Plate: the one number ---------- */}

              <section className="hm-plate" aria-live="polite">
                <p className="hm-figure">
                  {result ? total.toLocaleString("th-TH") : "—"}
                </p>

                <h1
                  className="hm-h2"
                  style={{ marginTop: "var(--space-md)" }}
                >
                  {result
                    ? `คะแนนรวม · ${board.election.name}`
                    : `${board.election.name} · ยังไม่มีผล`}
                </h1>

                <p className="hm-lead" style={{ maxWidth: "36ch" }}>
                  {result
                    ? board.election.description
                    : board.election.ended
                      ? "การเลือกตั้งสิ้นสุดแล้ว รอผู้ดูแลเปิดเผยผลคะแนน (reveal)"
                      : `ผลคะแนนจะขึ้นหลังการเลือกตั้งสิ้นสุด ${formatTime(board.election.endUnix)} และผู้ดูแลเปิดเผยผล`}
                </p>
              </section>

              {/* ---------- Ledger ---------- */}

              <dl className="hm-ledger">
                <div>
                  <dt>สถานะ</dt>
                  <dd>{status}</dd>
                </div>

                <div>
                  <dt>พรรค</dt>
                  <dd>{board.rows.length}</dd>
                </div>

                <div>
                  <dt>สิ้นสุด</dt>
                  <dd>{formatTime(board.election.endUnix)}</dd>
                </div>

                {result && (
                  <div>
                    <dt>เปิดเผย</dt>
                    <dd>{formatTime(result.revealedAt)}</dd>
                  </div>
                )}
              </dl>

              {/* ---------- Ranking ---------- */}

              {result && (
                <section>
                  <div className="hm-head">
                    <h2 className="hm-h2">อันดับ</h2>

                    <span className="hm-label">คะแนน · สัดส่วน</span>
                  </div>

                  <ol className="hm-ballot hm-rank" style={{ borderTop: 0 }}>
                    {board.rows.map((row, index) => {
                      const pct = total > 0 ? (row.votes / total) * 100 : 0;
                      const lead = topVotes > 0 && row.votes === topVotes;

                      return (
                        <li
                          key={row.partyId}
                          className={lead ? "is-lead" : undefined}
                        >
                          <span className="hm-num">{index + 1}</span>

                          <Logo name={row.name} url={row.logoUrl} />

                          <span className="hm-name">
                            {lead && (
                              <span
                                className="hm-period"
                                style={{
                                  marginInlineEnd: "0.45em",
                                  verticalAlign: "0.05em",
                                }}
                                role="img"
                                aria-label="คะแนนสูงสุด"
                              />
                            )}

                            {row.name}

                            <span className="hm-sub">เบอร์ {row.partyId}</span>
                          </span>

                          <span className="hm-votes">
                            {row.votes.toLocaleString("th-TH")}

                            <small>{pct.toFixed(1)}%</small>
                          </span>

                          <span className="hm-meter" aria-hidden="true">
                            <i style={{ width: `${pct}%` }} />
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
            </>
          )}

          {/* ---------- Actions ---------- */}

          <div className="hm-actions">
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              aria-busy={loading}
              className="hm-btn hm-btn--sm"
            >
              <IconRefresh
                size={16}
                className={loading ? "animate-spin" : ""}
              />
              {loading ? "กำลังโหลด…" : "รีเฟรช"}
            </button>

            <Link href="/vote" className="hm-link">
              <IconArrowLeft size={16} />
              กลับหน้าลงคะแนน
            </Link>

            {updatedAt && !loading && (
              <span className="hm-label">
                อัปเดต {updatedAt.toLocaleTimeString("th-TH")}
              </span>
            )}
          </div>

        </main>
      </Shell>
    </>
  );
}
