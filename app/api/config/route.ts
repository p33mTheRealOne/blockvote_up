import { NextResponse } from "next/server";

import { getActiveElection } from "@/lib/election-config";

export const dynamic = "force-dynamic";

/*
 * GET /api/config
 * คืน election_id ที่เปิดใช้งานอยู่ทั้งเว็บ
 */
export async function GET() {
  try {
    const active = await getActiveElection();

    return NextResponse.json(
      {
        electionId: active.electionId,
        source: active.source,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("config error:", error);

    return NextResponse.json(
      {
        error:
          "โหลดการตั้งค่าการเลือกตั้งไม่สำเร็จ",
      },
      { status: 503 }
    );
  }
}
