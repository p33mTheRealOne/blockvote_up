"use client";

import { useEffect, useState } from "react";

/*
 * ดึง election_id ที่ admin ตั้งไว้ทั้งเว็บ จาก /api/config
 *
 * - electionId เป็น null ระหว่างโหลด หรือเมื่อโหลดไม่สำเร็จ
 * - ตั้งใจ "ไม่" fallback เป็นเลขเริ่มต้นฝั่ง client
 *   เพื่อไม่ให้ผู้ใช้ไปยืนยัน/โหวตผิด election
 */

// หลาย component เรียกพร้อมกัน (เช่น หน้า + Shell) ให้ใช้ request เดียวกัน
let inflight: Promise<number> | null = null;

function loadElectionId(): Promise<number> {
  if (!inflight) {
    inflight = fetch("/api/config", {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json();

        if (
          !res.ok ||
          typeof data.electionId !== "number"
        ) {
          throw new Error(
            data?.error ||
              "โหลดการตั้งค่าการเลือกตั้งไม่สำเร็จ"
          );
        }

        return data.electionId as number;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

export function useElectionId(): {
  electionId: number | null;
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{
    electionId: number | null;
    loading: boolean;
    error: string | null;
  }>({
    electionId: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    loadElectionId()
      .then((id) => {
        if (!cancelled) {
          setState({
            electionId: id,
            loading: false,
            error: null,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            electionId: null,
            loading: false,
            error:
              err instanceof Error
                ? err.message
                : "โหลดการตั้งค่าการเลือกตั้งไม่สำเร็จ",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
