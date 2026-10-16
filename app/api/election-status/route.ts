import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, type Idl, BN } from "@coral-xyz/anchor";

import idl from "@/lib/idl/blockvote.json";

const PROGRAM_ID = new PublicKey(
  "28Pb8bp4T6Eb1pRNVYe6BUS3PRHjyr1wsha2PA4sn9Lj"
);

const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

function u64Bytes(value: number | bigint): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);

  view.setBigUint64(0, BigInt(value), true);

  return new Uint8Array(buffer);
}

function getElectionPda(electionId: number | bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("election"),
      Buffer.from(u64Bytes(electionId)),
    ],
    PROGRAM_ID
  );

  return pda;
}

function getReadOnlyProgram() {
  const connection = new Connection(RPC_URL, "confirmed");

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

  return new Program(idl as Idl, provider);
}

export async function GET(req: NextRequest) {
  try {
    const electionIdParam =
      req.nextUrl.searchParams.get("electionId");

    if (!electionIdParam) {
      return NextResponse.json(
        {
          error: "ไม่พบ Election ID",
        },
        { status: 400 }
      );
    }

    if (!/^\d+$/.test(electionIdParam)) {
      return NextResponse.json(
        {
          error: "Election ID ไม่ถูกต้อง",
        },
        { status: 400 }
      );
    }

    const electionId = BigInt(electionIdParam);

    const electionPda = getElectionPda(electionId);

    const program: any = getReadOnlyProgram();

    const election =
      await program.account.election.fetch(electionPda);

    const startUnix = Number(election.startUnix);
    const endUnix = Number(election.endUnix);

    const nowUnix = Math.floor(Date.now() / 1000);

    let state:
      | "not-started"
      | "active"
      | "ended";

    if (nowUnix < startUnix) {
      state = "not-started";
    } else if (nowUnix >= endUnix) {
      state = "ended";
    } else {
      state = "active";
    }

    return NextResponse.json({
      success: true,

      electionId: electionId.toString(),

      name: election.name,
      description: election.description,

      startUnix,
      endUnix,

      nowUnix,

      state,

      canVerify:
        nowUnix >= startUnix &&
        nowUnix < endUnix,
    });
  } catch (error) {
    console.error("election-status error:", error);

    return NextResponse.json(
      {
        error:
          "ไม่สามารถอ่านข้อมูล Election จาก Solana ได้",
      },
      { status: 500 }
    );
  }
}