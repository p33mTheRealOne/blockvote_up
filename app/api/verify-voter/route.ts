import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  isVoterAlreadyRegistered,
  registerVoterOnChain,
} from "@/lib/solana-admin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { walletAddress, idNumber, faceSimilarity, faceConfidence } = body;

    if (!walletAddress || !idNumber) {
      return NextResponse.json({ error: "ข้อมูลไม่ครบถ้วน" }, { status: 400 });
    }

    const cleanId = String(idNumber).replace(/\D/g, "");
    if (cleanId.length !== 13) {
      return NextResponse.json(
        { error: "เลขบัตรประชาชนไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    const pepper = process.env.ID_HASH_PEPPER;
    if (!pepper) {
      console.error("ID_HASH_PEPPER is not set");
      return NextResponse.json(
        { error: "เซิร์ฟเวอร์ตั้งค่าไม่ถูกต้อง" },
        { status: 500 }
      );
    }

    const citizenIdHash = createHmac("sha256", pepper)
      .update(cleanId)
      .digest("hex");

    // --- Claim the ID hash atomically via the DB unique constraint.
    // This runs BEFORE the on-chain call so two concurrent requests
    // with the same ID can't both slip through and both pay for a
    // register_voter transaction. ---
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("verified_voters")
      .insert({
        citizen_id_hash: citizenIdHash,
        face_similarity: faceSimilarity ?? null,
        face_confidence: faceConfidence ?? null,
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        // unique_violation
        return NextResponse.json(
          { error: "บัตรประชาชนใบนี้เคยใช้ยืนยันตัวตนไปแล้ว" },
          { status: 409 }
        );
      }
      console.error(insertError);
      return NextResponse.json(
        { error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่" },
        { status: 500 }
      );
    }

    // --- Wallet-level duplicate check (on-chain, since the table
    // above doesn't store wallet addresses). ---
    let alreadyRegistered = false;
    try {
      alreadyRegistered = await isVoterAlreadyRegistered(walletAddress);
    } catch (err) {
      console.error(err);
      await supabaseAdmin
        .from("verified_voters")
        .delete()
        .eq("id", inserted.id);
      return NextResponse.json(
        { error: "ตรวจสอบสถานะบนเชนไม่สำเร็จ กรุณาลองใหม่" },
        { status: 500 }
      );
    }

    if (alreadyRegistered) {
      await supabaseAdmin
        .from("verified_voters")
        .delete()
        .eq("id", inserted.id);
      return NextResponse.json(
        { error: "กระเป๋าเงินนี้ลงทะเบียนสิทธิ์โหวตไปแล้ว" },
        { status: 409 }
      );
    }

    // --- Register on-chain, signed by the admin authority ---
    try {
      const tx = await registerVoterOnChain(walletAddress);
      return NextResponse.json({ success: true, tx });
    } catch (chainErr) {
      console.error(chainErr);
      // Roll back the claimed ID hash so the person can retry instead
      // of being permanently locked out by a failed chain call.
      await supabaseAdmin
        .from("verified_voters")
        .delete()
        .eq("id", inserted.id);
      return NextResponse.json(
        { error: "ลงทะเบียนบนเชนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}