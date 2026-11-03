import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import {
  ADMIN_WALLET,
  buildSetElectionMessage,
} from "@/lib/election";
import { setActiveElectionId } from "@/lib/election-config";
import { deriveElectionPda } from "@/lib/solana-admin";

const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

// คำขอที่เซ็นไว้ใช้ได้ไม่เกิน 5 นาที
const MAX_AGE_MS = 5 * 60 * 1000;

/*
 * POST /api/admin/election-id
 * body: { electionId, timestamp, signature(base64) }
 *
 * ยืนยันตัวตนด้วยลายเซ็นของ ADMIN_WALLET เท่านั้น
 * (ไม่เชื่อการเช็ก wallet ฝั่ง browser)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { electionId, timestamp, signature } =
      body ?? {};

    if (
      !/^\d+$/.test(String(electionId ?? "")) ||
      typeof timestamp !== "number" ||
      typeof signature !== "string"
    ) {
      return NextResponse.json(
        { error: "ข้อมูลไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    const id = Number(electionId);

    if (!Number.isSafeInteger(id)) {
      return NextResponse.json(
        { error: "Election ID ไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    // ---- ตรวจอายุของคำขอ ----
    if (Math.abs(Date.now() - timestamp) > MAX_AGE_MS) {
      return NextResponse.json(
        {
          error:
            "คำขอหมดอายุ กรุณาลองใหม่อีกครั้ง",
        },
        { status: 400 }
      );
    }

    // ---- ตรวจลายเซ็นของ admin ----
    let signatureBytes: Uint8Array;

    try {
      signatureBytes = Uint8Array.from(
        Buffer.from(signature, "base64")
      );
    } catch {
      return NextResponse.json(
        { error: "ลายเซ็นไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    const message = new TextEncoder().encode(
      buildSetElectionMessage(id, timestamp)
    );

    const valid =
      signatureBytes.length === 64 &&
      nacl.sign.detached.verify(
        message,
        signatureBytes,
        new PublicKey(ADMIN_WALLET).toBytes()
      );

    if (!valid) {
      return NextResponse.json(
        { error: "ไม่มีสิทธิ์ (ลายเซ็นไม่ถูกต้อง)" },
        { status: 403 }
      );
    }

    // ---- election ต้องมีอยู่จริงบนเชน ----
    const connection = new Connection(
      RPC_URL,
      "confirmed"
    );

    const info = await connection.getAccountInfo(
      deriveElectionPda(id)
    );

    if (!info) {
      return NextResponse.json(
        {
          error: `ไม่พบ Election #${id} บน Solana (ต้องสร้างด้วย Create Election ก่อน)`,
        },
        { status: 404 }
      );
    }

    await setActiveElectionId(id, timestamp);

    return NextResponse.json({
      success: true,
      electionId: id,
    });
  } catch (error) {
    console.error("set election error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "เกิดข้อผิดพลาด",
      },
      { status: 500 }
    );
  }
}
