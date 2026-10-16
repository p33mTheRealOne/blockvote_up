"use client";

import { useEffect, useState } from "react";

import { ELECTION_ID } from "@/lib/election";
import { fetchScoreboard } from "@/lib/reveal";

type Board = NonNullable<Awaited<ReturnType<typeof fetchScoreboard>>>;

function formatTime(unix: number) {
  return new Date(unix * 1000).toLocaleString("th-TH");
}

export default function ScoreboardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetchScoreboard(ELECTION_ID)
      .then((result) => {
        if (cancelled) return;

        if (!result) {
          setError(`ไม่พบ Election ${ELECTION_ID} บนเชน`);
        } else {
          setBoard(result);
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
  }, []);

  const total = board?.result?.totalVotes ?? 0;
  const topVotes = board?.rows[0]?.votes ?? 0;

  const card: React.CSSProperties = {
    width: "100%",
    maxWidth: 720,
    background: "#fff",
    borderRadius: 20,
    padding: 32,
    boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        padding: "48px 16px",
        background: "#f8fafc",
      }}
    >
      <div style={card}>
        <p style={{ margin: 0, fontSize: 12, letterSpacing: 2, color: "#2563eb" }}>
          SCOREBOARD
        </p>

        <h1 style={{ margin: "6px 0 4px", fontSize: 28, color: "#0f172a" }}>
          {board?.election.name ?? "ผลการเลือกตั้ง"}
        </h1>

        {board && (
          <p style={{ margin: 0, color: "#64748b" }}>
            {board.election.description}
          </p>
        )}

        {loading && <p style={{ marginTop: 28 }}>กำลังโหลดผลคะแนน...</p>}

        {error && (
          <p style={{ marginTop: 28, color: "#dc2626" }}>{error}</p>
        )}

        {board && !board.result && (
          <div
            style={{
              marginTop: 28,
              padding: 20,
              borderRadius: 12,
              background: "#f1f5f9",
              color: "#334155",
            }}
          >
            {board.election.ended
              ? "การเลือกตั้งสิ้นสุดแล้ว — รอ admin เปิดเผยผลคะแนน (reveal)"
              : `การเลือกตั้งยังไม่สิ้นสุด (สิ้นสุด ${formatTime(
                  board.election.endUnix
                )}) — ผลคะแนนจะแสดงหลัง admin reveal`}
          </div>
        )}

        {board?.result && (
          <>
            <p style={{ margin: "20px 0 8px", color: "#64748b", fontSize: 14 }}>
              คะแนนรวม {total.toLocaleString()} • Reveal เมื่อ{" "}
              {formatTime(board.result.revealedAt)}
            </p>

            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {board.rows.map((row, index) => {
                const pct = total > 0 ? (row.votes / total) * 100 : 0;
                const isWinner = topVotes > 0 && row.votes === topVotes;

                return (
                  <li
                    key={row.partyId}
                    style={{
                      padding: "16px 0",
                      borderTop: index === 0 ? "none" : "1px solid #e2e8f0",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 28, fontWeight: 700, color: "#64748b" }}>
                        {index + 1}
                      </span>

                      {row.logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.logoUrl}
                          alt=""
                          width={40}
                          height={40}
                          style={{ borderRadius: 8, objectFit: "cover" }}
                        />
                      )}

                      <span style={{ flex: 1, fontWeight: 600, color: "#0f172a" }}>
                        {row.name}
                        {isWinner && " 🏆"}
                      </span>

                      <span style={{ fontWeight: 700 }}>
                        {row.votes.toLocaleString()}{" "}
                        <span style={{ color: "#64748b", fontWeight: 400 }}>
                          ({pct.toFixed(1)}%)
                        </span>
                      </span>
                    </div>

                    <div
                      style={{
                        height: 8,
                        marginTop: 10,
                        borderRadius: 999,
                        background: "#e2e8f0",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: isWinner ? "#16a34a" : "#2563eb",
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </main>
  );
}
