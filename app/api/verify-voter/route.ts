import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { PublicKey, Connection } from "@solana/web3.js";

import { supabaseAdmin } from "@/lib/supabase-server";

import {
  deriveElectionPda,
  isVoterAlreadyRegistered,
  registerVoterOnChain,
} from "@/lib/solana-admin";

import { validateCitizenId } from "@/lib/thai-id";

const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

async function getElectionTimes(
  electionId: number | bigint
) {
  const connection = new Connection(
    RPC_URL,
    "confirmed"
  );

  const electionPda =
    deriveElectionPda(electionId);

  const info =
    await connection.getAccountInfo(
      electionPda
    );

  if (!info) {
    throw new Error(
      "ไม่พบ Election นี้บน Solana"
    );
  }

  /*
   * We use Anchor on the server for decoding.
   * Importing Anchor here is safe because this is
   * an API route, not a browser component.
   */

  const { AnchorProvider, Program } =
    await import("@coral-xyz/anchor");

  const idl =
    (await import("@/lib/idl/blockvote.json"))
      .default;

  const dummyWallet = {
    publicKey: PublicKey.unique(),

    signTransaction: async () => {
      throw new Error("Read-only");
    },

    signAllTransactions: async () => {
      throw new Error("Read-only");
    },
  };

  const provider = new AnchorProvider(
    connection,
    dummyWallet as any,
    {
      commitment: "confirmed",
    }
  );

  const program: any =
    new Program(idl as any, provider);

  const election =
    await program.account.election.fetch(
      electionPda
    );

  return {
    startUnix: Number(election.startUnix),
    endUnix: Number(election.endUnix),
  };
}

export async function POST(
  req: NextRequest
) {
  try {
    const body = await req.json();

    const {
      electionId,
      walletAddress,
      idNumber,
      faceSimilarity,
      faceConfidence,
    } = body;

    // -----------------------------------------
    // Basic validation
    // -----------------------------------------

    if (
      electionId === undefined ||
      electionId === null ||
      !walletAddress ||
      !idNumber
    ) {
      return NextResponse.json(
        {
          error: "ข้อมูลไม่ครบถ้วน",
        },
        { status: 400 }
      );
    }

    if (
      !/^\d+$/.test(
        String(electionId)
      )
    ) {
      return NextResponse.json(
        {
          error: "Election ID ไม่ถูกต้อง",
        },
        { status: 400 }
      );
    }

    const electionIdBig =
      BigInt(String(electionId));

    // -----------------------------------------
    // Validate wallet
    // -----------------------------------------

    try {
      new PublicKey(walletAddress);
    } catch {
      return NextResponse.json(
        {
          error: "Wallet address ไม่ถูกต้อง",
        },
        { status: 400 }
      );
    }

    // -----------------------------------------
    // IMPORTANT:
    // Check Election start/end on-chain
    // -----------------------------------------

    const {
      startUnix,
      endUnix,
    } = await getElectionTimes(
      electionIdBig
    );

    const nowUnix =
      Math.floor(Date.now() / 1000);

    if (nowUnix < startUnix) {
      return NextResponse.json(
        {
          error:
            "การเลือกตั้งยังไม่เริ่ม ไม่สามารถยืนยันตัวตนได้",
          startUnix,
          nowUnix,
        },
        { status: 403 }
      );
    }

    if (nowUnix >= endUnix) {
      return NextResponse.json(
        {
          error:
            "การเลือกตั้งสิ้นสุดแล้ว ไม่สามารถยืนยันตัวตนได้",
        },
        { status: 403 }
      );
    }

    // -----------------------------------------
    // Validate Thai ID
    // -----------------------------------------

    const cleanId =
      String(idNumber).replace(/\D/g, "");

    if (
      cleanId.length !== 13 ||
      !validateCitizenId(cleanId)
    ) {
      return NextResponse.json(
        {
          error:
            "เลขบัตรประชาชนไม่ถูกต้อง",
        },
        { status: 400 }
      );
    }

    // -----------------------------------------
    // Face verification result
    //
    // IMPORTANT:
    // These values are produced by the browser.
    // They are suitable for the school-project
    // demo, but are not equivalent to a
    // production identity-verification service.
    // -----------------------------------------

    const similarity =
      Number(faceSimilarity);

    if (
      !Number.isFinite(similarity) ||
      similarity < 0 ||
      similarity > 1
    ) {
      return NextResponse.json(
        {
          error:
            "ผลการตรวจสอบใบหน้าไม่ถูกต้อง",
        },
        { status: 400 }
      );
    }

    const allowedConfidence = new Set([
      "VERY_HIGH",
      "HIGH",
      "MEDIUM",
    ]);

    if (
      typeof faceConfidence !== "string" ||
      !allowedConfidence.has(
        faceConfidence
      )
    ) {
      return NextResponse.json(
        {
          error:
            "ไม่ผ่านระดับความมั่นใจของการตรวจใบหน้า",
        },
        { status: 403 }
      );
    }

    // -----------------------------------------
    // Hash citizen ID
    // -----------------------------------------

    const pepper =
      process.env.ID_HASH_PEPPER;

    if (!pepper) {
      console.error(
        "ID_HASH_PEPPER is not set"
      );

      return NextResponse.json(
        {
          error:
            "เซิร์ฟเวอร์ตั้งค่าไม่ถูกต้อง",
        },
        { status: 500 }
      );
    }

    const citizenIdHash =
      createHmac(
        "sha256",
        pepper
      )
        .update(cleanId)
        .digest("hex");

    // -----------------------------------------
    // Claim citizen ID for this election
    //
    // NO walletAddress is stored.
    // -----------------------------------------

    const {
      data: inserted,
      error: insertError,
    } = await supabaseAdmin
      .from("verified_voters")
      .insert({
        election_id:
          Number(electionIdBig),

        citizen_id_hash:
          citizenIdHash,

        face_similarity:
          similarity,

        face_confidence:
          faceConfidence,
      })
      .select("id")
      .single();

    if (insertError) {
      if (
        insertError.code === "23505"
      ) {
        return NextResponse.json(
          {
            error:
              "บัตรประชาชนใบนี้เคยยืนยันตัวตนในการเลือกตั้งนี้แล้ว",
          },
          { status: 409 }
        );
      }

      console.error(
        insertError
      );

      return NextResponse.json(
        {
          error:
            "บันทึกข้อมูลไม่สำเร็จ",
        },
        { status: 500 }
      );
    }

    // -----------------------------------------
    // Check wallet on-chain
    // -----------------------------------------

    try {
      const alreadyRegistered =
        await isVoterAlreadyRegistered(
          electionIdBig,
          walletAddress
        );

      if (alreadyRegistered) {
        await supabaseAdmin
          .from("verified_voters")
          .delete()
          .eq("id", inserted.id);

        return NextResponse.json(
          {
            error:
              "Wallet นี้ลงทะเบียนสิทธิ์ในการเลือกตั้งนี้แล้ว",
          },
          { status: 409 }
        );
      }
    } catch (error) {
      console.error(error);

      await supabaseAdmin
        .from("verified_voters")
        .delete()
        .eq("id", inserted.id);

      return NextResponse.json(
        {
          error:
            "ตรวจสอบ Wallet บน Solana ไม่สำเร็จ",
        },
        { status: 500 }
      );
    }

    // -----------------------------------------
    // Register voter on-chain
    // signed by ADMIN_PRIVATE_KEY
    // -----------------------------------------

    try {
      const tx =
        await registerVoterOnChain(
          electionIdBig,
          walletAddress
        );

      return NextResponse.json({
        success: true,
        tx,
        electionId:
          electionIdBig.toString(),
      });
    } catch (error) {
      console.error(
        "register_voter failed:",
        error
      );

      // Roll back DB claim
      await supabaseAdmin
        .from("verified_voters")
        .delete()
        .eq("id", inserted.id);

      return NextResponse.json(
        {
          error:
            "ลงทะเบียนสิทธิ์บน Solana ไม่สำเร็จ กรุณาลองใหม่",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error(
      "verify-voter error:",
      error
    );

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