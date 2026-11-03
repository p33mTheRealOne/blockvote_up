import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import {
  AnchorProvider,
  Program,
  type Idl,
  BN,
} from "@coral-xyz/anchor";

import bs58 from "bs58";

import idl from "@/lib/idl/blockvote.json";

const PROGRAM_ID = new PublicKey(
  "28Pb8bp4T6Eb1pRNVYe6BUS3PRHjyr1wsha2PA4sn9Lj"
);

const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

let adminKeypairSingleton: Keypair | null = null;
let adminProgramSingleton: Program | null = null;

function u64Bytes(value: number | bigint): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);

  view.setBigUint64(0, BigInt(value), true);

  return new Uint8Array(buffer);
}

export function deriveElectionPda(
  electionId: number | bigint
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("election"),
      Buffer.from(u64Bytes(electionId)),
    ],
    PROGRAM_ID
  );

  return pda;
}

export function deriveVoterPda(
  electionId: number | bigint,
  wallet: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("voter"),
      Buffer.from(u64Bytes(electionId)),
      wallet.toBuffer(),
    ],
    PROGRAM_ID
  );

  return pda;
}

function loadAdminKeypair() {
  if (adminKeypairSingleton) {
    return adminKeypairSingleton;
  }

  const secret = process.env.ADMIN_PRIVATE_KEY?.trim();

  if (!secret) {
    throw new Error(
      "ADMIN_PRIVATE_KEY is not set on the server"
    );
  }

  let secretKey: Uint8Array;

  // รองรับ Solana secret key แบบ JSON array
  // เช่น [12,34,56,78,...]
  if (secret.startsWith("[")) {
    try {
      const parsed = JSON.parse(secret);

      if (!Array.isArray(parsed)) {
        throw new Error(
          "ADMIN_PRIVATE_KEY JSON must be an array"
        );
      }

      if (
        parsed.length !== 64 &&
        parsed.length !== 32
      ) {
        throw new Error(
          `ADMIN_PRIVATE_KEY must contain 64 bytes, got ${parsed.length}`
        );
      }

      if (
        !parsed.every(
          (value) =>
            Number.isInteger(value) &&
            value >= 0 &&
            value <= 255
        )
      ) {
        throw new Error(
          "ADMIN_PRIVATE_KEY contains invalid byte values"
        );
      }

      secretKey = Uint8Array.from(parsed);
    } catch (error) {
      throw new Error(
        `Invalid ADMIN_PRIVATE_KEY JSON array: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  } else {
    // รองรับ Base58 ด้วย
    try {
      secretKey = bs58.decode(secret);
    } catch {
      throw new Error(
        "ADMIN_PRIVATE_KEY must be either a Base58 private key or a JSON byte array"
      );
    }
  }

  adminKeypairSingleton =
    Keypair.fromSecretKey(secretKey);

  return adminKeypairSingleton;
}

function getAdminProgram(): Program {
  if (adminProgramSingleton) {
    return adminProgramSingleton;
  }

  const connection = new Connection(
    RPC_URL,
    "confirmed"
  );

  const adminKeypair = loadAdminKeypair();

  const wallet = {
    publicKey: adminKeypair.publicKey,

    async signTransaction<
      T extends Transaction | VersionedTransaction
    >(tx: T): Promise<T> {
      if (tx instanceof VersionedTransaction) {
        tx.sign([adminKeypair]);
      } else {
        tx.partialSign(adminKeypair);
      }

      return tx;
    },

    async signAllTransactions<
      T extends Transaction | VersionedTransaction
    >(txs: T[]): Promise<T[]> {
      for (const tx of txs) {
        if (tx instanceof VersionedTransaction) {
          tx.sign([adminKeypair]);
        } else {
          tx.partialSign(adminKeypair);
        }
      }

      return txs;
    },
  };

  const provider = new AnchorProvider(
    connection,
    wallet as any,
    {
      commitment: "confirmed",
    }
  );

  adminProgramSingleton = new Program(
    idl as Idl,
    provider
  );

  return adminProgramSingleton;
}

export async function isVoterAlreadyRegistered(
  electionId: number | bigint,
  walletAddress: string
): Promise<boolean> {
  const wallet = new PublicKey(walletAddress);

  const voterPda = deriveVoterPda(
    electionId,
    wallet
  );

  const connection = new Connection(
    RPC_URL,
    "confirmed"
  );

  const account =
    await connection.getAccountInfo(voterPda);

  return account !== null;
}

export async function registerVoterOnChain(
  electionId: number | bigint,
  walletAddress: string
): Promise<string> {
  const program: any = getAdminProgram();

  const admin = loadAdminKeypair();

  const voterWallet =
    new PublicKey(walletAddress);

  const electionPda =
    deriveElectionPda(electionId);

  const voterPda =
    deriveVoterPda(
      electionId,
      voterWallet
    );

  // Verify that this election actually exists.
  await program.account.election.fetch(
    electionPda
  );

  const tx = await program.methods
    .registerVoter(
      new BN(electionId.toString()),
      voterWallet
    )
    .accounts({
      admin: admin.publicKey,
      election: electionPda,
      voter: voterPda,
      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  return tx;
}


/* =========================================================
   AIRDROP TO VERIFIED VOTER
   โอน SOL (devnet) จาก admin wallet ให้ wallet ที่ผ่านการยืนยันตัวตน
   เพื่อใช้จ่ายค่าธรรมเนียมตอนโหวต
========================================================= */

// 0.002 SOL
export const VOTER_AIRDROP_LAMPORTS = 2_000_000;

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

export async function sendVoterAirdrop(
  electionId: number | bigint,
  walletAddress: string
): Promise<string> {
  const voterWallet = new PublicKey(walletAddress);

  /*
   * โอนให้เฉพาะ wallet ที่ลงทะเบียนสิทธิ์บนเชนแล้วเท่านั้น
   * (Voter PDA จะถูกสร้างหลังผ่านการยืนยันตัวตนครบทุกขั้นเท่านั้น)
   * RPC อาจเห็นบัญชีช้าเล็กน้อย จึงลองซ้ำไม่กี่ครั้ง
   */
  let registered = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    registered = await isVoterAlreadyRegistered(
      electionId,
      walletAddress
    );

    if (registered) {
      break;
    }

    await sleep(700);
  }

  if (!registered) {
    throw new Error(
      "Wallet นี้ยังไม่ได้ลงทะเบียนสิทธิ์ จึงไม่โอน SOL ให้"
    );
  }

  const admin = loadAdminKeypair();

  const connection = new Connection(
    RPC_URL,
    "confirmed"
  );

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: voterWallet,
      lamports: VOTER_AIRDROP_LAMPORTS,
    })
  );

  return await sendAndConfirmTransaction(
    connection,
    tx,
    [admin],
    { commitment: "confirmed" }
  );
}
