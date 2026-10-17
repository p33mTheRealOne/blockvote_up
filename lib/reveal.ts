"use client";

/*
 * ฟังก์ชันฝั่งเว็บสำหรับ
 *   - initialize_election_crypto  (admin สร้างกุญแจเข้ารหัส ballot)
 *   - reveal_results              (admin ถอดรหัส + บันทึกผลลงเชน)
 *   - อ่านผลคะแนนที่ถูก reveal แล้ว (ทุกคนอ่านได้ -> /scoreboard)
 *
 * รูปแบบ ballot / key file ตรงกับ tests/init_election_crypto.ts
 * และ tests/decrypt_votes.ts ใน smart contract:
 *
 *   encrypted_vote = [ephemeral pk 32][nonce 24][ciphertext 24] = 80 bytes
 *   plaintext      = party_id u64 little-endian
 *   key file       = { electionId, publicKey (base64), secretKey: number[32] }
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import {
  BLOCKVOTE_IDL,
  PhantomAnchorWallet,
  type PhantomWalletProvider,
  connection,
  getElectionCryptoPda,
  getElectionPda,
  getElectionResultPda,
  getProgram,
} from "@/lib/anchor";
import { ADMIN_WALLET } from "@/lib/election";

/* =========================================================
   TYPES
========================================================= */

export interface ElectionKeyFile {
  electionId: number;
  publicKey: string; // base64
  secretKey: number[]; // 32 bytes
}

export interface PartyTally {
  partyId: number;
  name: string;
  logoUrl: string;
  votes: number;
}

export interface DecryptPreview {
  tallies: PartyTally[];
  encryptedVotes: number;
  validVotes: number;
  invalidVotes: number;
}

export interface RevealedResults {
  electionId: number;
  election: PublicKey;
  revealedBy: PublicKey;
  revealedAt: number;
  totalVotes: number;
  tallies: { partyId: number; votes: number }[];
}

export interface ElectionInfo {
  name: string;
  description: string;
  startUnix: number;
  endUnix: number;
  status: number;
  ended: boolean;
}

/* =========================================================
   HELPERS
========================================================= */

export function parseElectionId(value: string | number): number {
  const text = String(value).trim();

  if (!/^\d+$/.test(text)) {
    throw new Error("Election ID ต้องเป็นตัวเลขเท่านั้น");
  }

  const id = Number(text);

  if (!Number.isSafeInteger(id)) {
    throw new Error("Election ID ใหญ่เกินไป");
  }

  return id;
}

export function assertAdminProvider(
  provider: PhantomWalletProvider | undefined
): asserts provider is PhantomWalletProvider {
  if (!provider) {
    throw new Error("ไม่พบ Phantom Wallet");
  }

  if (!provider.publicKey) {
    throw new Error("กรุณาเชื่อมต่อ wallet admin ก่อน");
  }

  if (provider.publicKey.toString() !== ADMIN_WALLET) {
    throw new Error("เฉพาะ wallet admin เท่านั้นที่ทำรายการนี้ได้");
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

/** ดาวน์โหลดไฟล์ในเบราว์เซอร์ */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =========================================================
   READ ELECTION
========================================================= */

export async function fetchElectionInfo(
  electionId: number
): Promise<ElectionInfo | null> {
  const [electionPda] = getElectionPda(electionId);

  const account = await connection.getAccountInfo(electionPda);

  if (!account) {
    return null;
  }

  /*
   * Election layout:
   * discriminator 8 | admin 32 | election_id 8 |
   * name 4+n | description 4+n | start 8 | end 8 | bump 1 | status 1
   */

  const data = account.data;
  let offset = 8 + 32 + 8;

  const nameLen = data.readUInt32LE(offset);
  offset += 4;
  const name = data.subarray(offset, offset + nameLen).toString("utf8");
  offset += nameLen;

  const descLen = data.readUInt32LE(offset);
  offset += 4;
  const description = data
    .subarray(offset, offset + descLen)
    .toString("utf8");
  offset += descLen;

  const startUnix = Number(data.readBigInt64LE(offset));
  offset += 8;
  const endUnix = Number(data.readBigInt64LE(offset));
  offset += 8;

  offset += 1; // bump
  const status = data.readUInt8(offset);

  return {
    name,
    description,
    startUnix,
    endUnix,
    status,
    ended: Math.floor(Date.now() / 1000) >= endUnix,
  };
}

/** Program แบบ read-only (ไม่ต้องใช้ wallet) สำหรับอ่านข้อมูลบนเชน */
function getReadOnlyProgram(): any {
  const dummyWallet = {
    publicKey: PublicKey.unique(),
    signTransaction: async () => {
      throw new Error("Read-only");
    },
    signAllTransactions: async () => {
      throw new Error("Read-only");
    },
  };

  const provider = new anchor.AnchorProvider(
    connection,
    dummyWallet as unknown as anchor.Wallet,
    { commitment: "confirmed" }
  );

  return new anchor.Program(BLOCKVOTE_IDL as anchor.Idl, provider);
}

async function fetchParties(electionPda: PublicKey) {
  const program = getReadOnlyProgram();

  const accounts: {
    account: { partyId: anchor.BN; name: string; logoUrl: string };
  }[] = await program.account.party.all([
    { memcmp: { offset: 8, bytes: electionPda.toBase58() } },
  ]);

  return accounts
    .map(({ account }) => ({
      partyId: account.partyId.toNumber(),
      name: account.name,
      logoUrl: account.logoUrl,
    }))
    .sort((x, y) => x.partyId - y.partyId);
}

/* =========================================================
   INITIALIZE ELECTION CRYPTO
========================================================= */

export async function electionCryptoExists(
  electionId: number
): Promise<boolean> {
  const [pda] = getElectionCryptoPda(electionId);

  return (await connection.getAccountInfo(pda)) !== null;
}

/**
 * สร้างกุญแจ X25519 ในเบราว์เซอร์ -> ดาวน์โหลด key file ก่อน
 * -> ส่ง initialize_election_crypto
 *
 * ดาวน์โหลดก่อนส่ง tx เสมอ เพราะถ้า tx สำเร็จแล้วทำ private key หาย
 * จะถอดรหัสคะแนนไม่ได้อีกเลย
 */
export async function initializeElectionCrypto(
  provider: PhantomWalletProvider | undefined,
  electionIdInput: string | number
): Promise<{ signature: string; publicKeyBase64: string }> {
  assertAdminProvider(provider);

  const electionId = parseElectionId(electionIdInput);

  const election = await fetchElectionInfo(electionId);

  if (!election) {
    throw new Error(`ไม่พบ Election ${electionId}`);
  }

  if (await electionCryptoExists(electionId)) {
    throw new Error(
      `Election ${electionId} ตั้งค่ากุญแจเข้ารหัสไปแล้ว`
    );
  }

  const keypair = nacl.box.keyPair();

  const keyFile: ElectionKeyFile = {
    electionId,
    publicKey: toBase64(keypair.publicKey),
    secretKey: Array.from(keypair.secretKey),
  };

  downloadJson(`election-${electionId}.json`, keyFile);

  const wallet = new PhantomAnchorWallet(provider);
  const program = getProgram(wallet);

  const [electionPda] = getElectionPda(electionId);
  const [electionCryptoPda] = getElectionCryptoPda(electionId);

  const signature: string = await program.methods
    .initializeElectionCrypto(
      new anchor.BN(electionId),
      Array.from(keypair.publicKey)
    )
    .accounts({
      admin: wallet.publicKey,
      election: electionPda,
      electionCrypto: electionCryptoPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  return {
    signature,
    publicKeyBase64: keyFile.publicKey,
  };
}

/* =========================================================
   KEY FILE
========================================================= */

export function parseKeyFile(
  text: string,
  electionId: number
): nacl.BoxKeyPair {
  let json: any;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("ไฟล์ key ไม่ใช่ JSON ที่ถูกต้อง");
  }

  if (Number(json?.electionId) !== electionId) {
    throw new Error(
      `ไฟล์ key นี้เป็นของ Election ${json?.electionId} ไม่ใช่ Election ${electionId}`
    );
  }

  if (
    !Array.isArray(json.secretKey) ||
    json.secretKey.length !== nacl.box.secretKeyLength ||
    !json.secretKey.every(
      (n: unknown) =>
        Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255
    )
  ) {
    throw new Error(
      `secretKey ต้องมี ${nacl.box.secretKeyLength} bytes`
    );
  }

  const keypair = nacl.box.keyPair.fromSecretKey(
    Uint8Array.from(json.secretKey)
  );

  if (typeof json.publicKey === "string") {
    const saved = Uint8Array.from(Buffer.from(json.publicKey, "base64"));

    if (saved.length === 32 && !bytesEqual(saved, keypair.publicKey)) {
      throw new Error("publicKey ในไฟล์ไม่ตรงกับ secretKey");
    }
  }

  return keypair;
}

async function fetchOnChainPublicKey(
  electionId: number,
  electionPda: PublicKey
): Promise<Uint8Array> {
  const [pda] = getElectionCryptoPda(electionId);

  const account = await connection.getAccountInfo(pda);

  if (!account) {
    throw new Error(
      "ยังไม่ได้ตั้งค่ากุญแจเข้ารหัสของ election นี้ (initialize_election_crypto)"
    );
  }

  /* ElectionCrypto: discriminator 8 | election 32 | public_key 32 | bump 1 */

  if (account.data.length < 73) {
    throw new Error("ข้อมูล ElectionCrypto ไม่ถูกต้อง");
  }

  const stored = new PublicKey(account.data.subarray(8, 40));

  if (!stored.equals(electionPda)) {
    throw new Error("ElectionCrypto ไม่ตรงกับ election นี้");
  }

  return new Uint8Array(account.data.subarray(40, 72));
}

/* =========================================================
   DECRYPT (ใช้ดู preview ก่อน reveal)
========================================================= */

export async function decryptElectionVotes(
  electionIdInput: string | number,
  keyFileText: string
): Promise<DecryptPreview> {
  const electionId = parseElectionId(electionIdInput);

  const election = await fetchElectionInfo(electionId);

  if (!election) {
    throw new Error(`ไม่พบ Election ${electionId}`);
  }

  if (!election.ended) {
    throw new Error(
      "การเลือกตั้งยังไม่สิ้นสุด ไม่สามารถถอดรหัสคะแนนได้"
    );
  }

  const [electionPda] = getElectionPda(electionId);

  const keypair = parseKeyFile(keyFileText, electionId);

  const onChainKey = await fetchOnChainPublicKey(
    electionId,
    electionPda
  );

  if (!bytesEqual(onChainKey, keypair.publicKey)) {
    throw new Error(
      "private key ในไฟล์ไม่ตรงกับ public key ของ election บนเชน"
    );
  }

  const parties = await fetchParties(electionPda);

  if (parties.length === 0) {
    throw new Error("Election นี้ยังไม่มีพรรค");
  }

  // Vote accounts ทั้งหมดของ election นี้
  const program = getReadOnlyProgram();

  const voteAccounts: { account: { encryptedVote: Buffer | Uint8Array } }[] =
    await program.account.vote.all([
      { memcmp: { offset: 8, bytes: electionPda.toBase58() } },
    ]);

  const counts = new Map<number, number>(
    parties.map((p) => [p.partyId, 0])
  );

  let validVotes = 0;
  let invalidVotes = 0;

  for (const { account } of voteAccounts) {
    const encrypted = Uint8Array.from(account.encryptedVote);

    // [ephemeral pk 32][nonce 24][ciphertext 24]
    if (encrypted.length !== 80) {
      invalidVotes++;
      continue;
    }

    const plaintext = nacl.box.open(
      encrypted.slice(56, 80),
      encrypted.slice(32, 56),
      encrypted.slice(0, 32),
      keypair.secretKey
    );

    if (!plaintext || plaintext.length !== 8) {
      invalidVotes++;
      continue;
    }

    const partyId = Number(
      new DataView(
        plaintext.buffer,
        plaintext.byteOffset,
        plaintext.byteLength
      ).getBigUint64(0, true)
    );

    if (!counts.has(partyId)) {
      invalidVotes++;
      continue;
    }

    counts.set(partyId, (counts.get(partyId) ?? 0) + 1);
    validVotes++;
  }

  return {
    tallies: parties.map((p) => ({
      ...p,
      votes: counts.get(p.partyId) ?? 0,
    })),
    encryptedVotes: voteAccounts.length,
    validVotes,
    invalidVotes,
  };
}

/* =========================================================
   REVEAL RESULTS (ADMIN ONLY)
========================================================= */

export async function revealResultsOnChain(
  provider: PhantomWalletProvider | undefined,
  electionIdInput: string | number,
  tallies: { partyId: number; votes: number }[]
): Promise<string> {
  assertAdminProvider(provider);

  const electionId = parseElectionId(electionIdInput);

  const election = await fetchElectionInfo(electionId);

  if (!election) {
    throw new Error(`ไม่พบ Election ${electionId}`);
  }

  if (!election.ended) {
    throw new Error("การเลือกตั้งยังไม่สิ้นสุด ยัง reveal ไม่ได้");
  }

  if (await fetchRevealedResults(electionId)) {
    throw new Error(`Election ${electionId} ถูก reveal ไปแล้ว`);
  }

  const wallet = new PhantomAnchorWallet(provider);
  const program = getProgram(wallet);

  const [electionPda] = getElectionPda(electionId);
  const [electionResultPda] = getElectionResultPda(electionId);

  return await program.methods
    .revealResults(
      new anchor.BN(electionId),
      tallies.map((t) => ({
        partyId: new anchor.BN(t.partyId),
        votes: new anchor.BN(t.votes),
      }))
    )
    .accounts({
      admin: wallet.publicKey,
      election: electionPda,
      electionResult: electionResultPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
}

/* =========================================================
   READ REVEALED RESULTS (PUBLIC)
========================================================= */

export async function fetchRevealedResults(
  electionIdInput: string | number
): Promise<RevealedResults | null> {
  const electionId = parseElectionId(electionIdInput);

  const [pda] = getElectionResultPda(electionId);

  const program = getReadOnlyProgram();

  const account = await program.account.electionResult.fetchNullable(pda);

  if (!account) {
    return null;
  }

  return {
    electionId,
    election: account.election as PublicKey,
    revealedBy: account.revealedBy as PublicKey,
    revealedAt: account.revealedAt.toNumber(),
    totalVotes: account.totalVotes.toNumber(),
    tallies: (
      account.tallies as { partyId: anchor.BN; votes: anchor.BN }[]
    ).map((t) => ({
      partyId: t.partyId.toNumber(),
      votes: t.votes.toNumber(),
    })),
  };
}

/** ข้อมูลทั้งหมดที่หน้า scoreboard ต้องใช้ */
export async function fetchScoreboard(electionId: number) {
  const election = await fetchElectionInfo(electionId);

  if (!election) {
    return null;
  }

  const [electionPda] = getElectionPda(electionId);

  const result = await fetchRevealedResults(electionId);

  if (!result) {
    return { election, result: null, rows: [] as PartyTally[] };
  }

  const parties = await fetchParties(electionPda);

  const rows: PartyTally[] = result.tallies.map((t) => {
    const party = parties.find((p) => p.partyId === t.partyId);

    return {
      partyId: t.partyId,
      name: party?.name ?? `Party ${t.partyId}`,
      logoUrl: party?.logoUrl ?? "",
      votes: t.votes,
    };
  });

  rows.sort((a, b) => b.votes - a.votes || a.partyId - b.partyId);

  return { election, result, rows };
}
