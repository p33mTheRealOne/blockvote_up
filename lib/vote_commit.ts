"use client";

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";

import {
  PROGRAM_ID,
  RPC_ENDPOINT,
  connection,
  getElectionPda,
  getVoterPda,
  getVotePda,
  getElectionCryptoPda,
  getPartyPda,
} from "@/lib/anchor";

import idl from "@/lib/idl/blockvote.json";


/* =========================================================
   TYPES
========================================================= */

export interface VoteCommitParams {
  walletProvider: PhantomVoteProvider;
  election: PublicKey;
  partyId: number;
}

export interface VoteCommitResult {
  tx: string;
  nonceHex: string;
  encryptedVoteBase64: string;
}


/* =========================================================
   PHANTOM PROVIDER
========================================================= */

export interface PhantomVoteProvider {
  publicKey?: PublicKey;

  connect: (options?: {
    onlyIfTrusted?: boolean;
  }) => Promise<{
    publicKey: PublicKey;
  }>;

  signTransaction: (
    transaction: Transaction
  ) => Promise<Transaction>;

  signAllTransactions?: (
    transactions: Transaction[]
  ) => Promise<Transaction[]>;

  disconnect?: () => Promise<void>;
}


/* =========================================================
   ANCHOR WALLET
========================================================= */

class PhantomWallet {
  constructor(
    private readonly provider: PhantomVoteProvider
  ) {}

  get publicKey(): PublicKey {
    if (!this.provider.publicKey) {
      throw new Error(
        "Phantom wallet is not connected."
      );
    }

    return this.provider.publicKey;
  }

  async signTransaction(
    transaction: Transaction
  ): Promise<Transaction> {
    return await this.provider.signTransaction(
      transaction
    );
  }

  async signAllTransactions(
    transactions: Transaction[]
  ): Promise<Transaction[]> {
    if (!this.provider.signAllTransactions) {
      throw new Error(
        "Phantom does not support signAllTransactions."
      );
    }

    return await this.provider.signAllTransactions(
      transactions
    );
  }
}


/* =========================================================
   GET ANCHOR PROGRAM
========================================================= */

function getVoteProgram(
  walletProvider: PhantomVoteProvider
): any {
  const wallet = new PhantomWallet(
    walletProvider
  );

  const provider =
    new anchor.AnchorProvider(
      connection,
      wallet as unknown as anchor.Wallet,
      {
        commitment: "confirmed",
      }
    );

  return new anchor.Program(
    idl as anchor.Idl,
    provider
  );
}


/* =========================================================
   READ ELECTION CRYPTO PUBLIC KEY
========================================================= */

async function getElectionEncryptionKey(
  electionId: number,
  electionPda: PublicKey
): Promise<Uint8Array> {
  const [cryptoPda] =
    getElectionCryptoPda(electionId);

  const account =
    await connection.getAccountInfo(
      cryptoPda
    );

  if (!account) {
    throw new Error(
      "ยังไม่ได้ตั้งค่ากุญแจเข้ารหัสของการเลือกตั้งนี้"
    );
  }

  /*
   * ElectionCrypto layout:
   *
   * discriminator  8
   * election       32
   * public_key     32
   * bump           1
   */

  const data = account.data;

  if (data.length < 73) {
    throw new Error(
      "ข้อมูล ElectionCrypto ไม่ถูกต้อง"
    );
  }

  const storedElection =
    new PublicKey(
      data.subarray(
        8,
        8 + 32
      )
    );

  if (
    !storedElection.equals(
      electionPda
    )
  ) {
    throw new Error(
      "ElectionCrypto ไม่ตรงกับ election นี้"
    );
  }

  const publicKey =
    data.subarray(
      8 + 32,
      8 + 32 + 32
    );

  if (publicKey.length !== 32) {
    throw new Error(
      "Election encryption public key ไม่ถูกต้อง"
    );
  }

  return new Uint8Array(
    publicKey
  );
}


/* =========================================================
   CHECK PARTY EXISTS
========================================================= */

async function checkPartyExists(
  electionId: number,
  partyId: number,
  electionPda: PublicKey
): Promise<void> {
  const [partyPda] =
    getPartyPda(
      electionId,
      partyId
    );

  const partyAccount =
    await connection.getAccountInfo(
      partyPda
    );

  if (!partyAccount) {
    throw new Error(
      `ไม่พบพรรคหมายเลข ${partyId} ในการเลือกตั้งนี้`
    );
  }

  /*
   * Party layout:
   *
   * discriminator  8
   * election       32
   * party_id       8
   * name           4 + variable
   * logo_url       4 + variable
   * bump           1
   */

  const data = partyAccount.data;

  if (data.length < 48) {
    throw new Error(
      "ข้อมูลพรรคไม่ถูกต้อง"
    );
  }

  const storedElection =
    new PublicKey(
      data.subarray(
        8,
        8 + 32
      )
    );

  if (
    !storedElection.equals(
      electionPda
    )
  ) {
    throw new Error(
      "พรรคนี้ไม่ได้อยู่ในการเลือกตั้งนี้"
    );
  }

  const storedPartyId =
    Number(
      data.readBigUInt64LE(40)
    );

  if (
    storedPartyId !== partyId
  ) {
    throw new Error(
      "หมายเลขพรรคไม่ตรงกับข้อมูลบนเชน"
    );
  }
}


/* =========================================================
   CHECK VOTER
========================================================= */

async function checkVoter(
  electionId: number,
  wallet: PublicKey,
  electionPda: PublicKey
): Promise<void> {
  const [voterPda] =
    getVoterPda(
      electionId,
      wallet
    );

  const voterAccount =
    await connection.getAccountInfo(
      voterPda
    );

  if (!voterAccount) {
    throw new Error(
      "Wallet นี้ยังไม่ได้รับการลงทะเบียนสำหรับการเลือกตั้งนี้"
    );
  }

  /*
   * Voter layout:
   *
   * discriminator  8
   * election        32
   * wallet          32
   * registered_at   8
   * voted           1
   * bump            1
   */

  const data =
    voterAccount.data;

  if (data.length < 82) {
    throw new Error(
      "ข้อมูล voter ไม่ถูกต้อง"
    );
  }

  const storedElection =
    new PublicKey(
      data.subarray(
        8,
        8 + 32
      )
    );

  const storedWallet =
    new PublicKey(
      data.subarray(
        40,
        40 + 32
      )
    );

  const voted =
    data.readUInt8(80) !== 0;

  if (
    !storedElection.equals(
      electionPda
    )
  ) {
    throw new Error(
      "Voter account ไม่ตรงกับการเลือกตั้งนี้"
    );
  }

  if (
    !storedWallet.equals(
      wallet
    )
  ) {
    throw new Error(
      "Voter account ไม่ตรงกับ wallet นี้"
    );
  }

  if (voted) {
    throw new Error(
      "Wallet นี้โหวตไปแล้ว ไม่สามารถโหวตซ้ำได้"
    );
  }
}


/* =========================================================
   CHECK ELECTION TIME
========================================================= */

async function checkElectionTime(
  electionPda: PublicKey
): Promise<void> {
  const account =
    await connection.getAccountInfo(
      electionPda
    );

  if (!account) {
    throw new Error(
      "ไม่พบข้อมูลการเลือกตั้งบนเชน"
    );
  }

  /*
   * Election layout:
   *
   * discriminator  8
   * admin           32
   * election_id     8
   * name            4 + variable
   * description     4 + variable
   * start_unix      8
   * end_unix        8
   * bump            1
   * status          1
   */

  const data =
    account.data;

  let offset = 8;

  // admin
  offset += 32;

  // election_id
  offset += 8;

  if (
    offset + 4 >
    data.length
  ) {
    throw new Error(
      "ข้อมูล election ไม่ถูกต้อง"
    );
  }

  // name
  const nameLength =
    data.readUInt32LE(
      offset
    );

  offset += 4;
  offset += nameLength;

  if (
    offset + 4 >
    data.length
  ) {
    throw new Error(
      "ข้อมูล election ไม่ถูกต้อง"
    );
  }

  // description
  const descriptionLength =
    data.readUInt32LE(
      offset
    );

  offset += 4;
  offset += descriptionLength;

  if (
    offset + 16 >
    data.length
  ) {
    throw new Error(
      "ข้อมูล election ไม่ถูกต้อง"
    );
  }

  const startUnix =
    Number(
      data.readBigInt64LE(
        offset
      )
    );

  offset += 8;

  const endUnix =
    Number(
      data.readBigInt64LE(
        offset
      )
    );

  const nowUnix =
    Math.floor(
      Date.now() / 1000
    );

  if (
    nowUnix < startUnix
  ) {
    throw new Error(
      "การเลือกตั้งยังไม่เริ่ม"
    );
  }

  if (
    nowUnix >= endUnix
  ) {
    throw new Error(
      "การเลือกตั้งสิ้นสุดแล้ว"
    );
  }
}


/* =========================================================
   CREATE ENCRYPTED BALLOT
========================================================= */

function createEncryptedBallot(
  partyId: number,
  encryptionPublicKey: Uint8Array
): {
  encryptedVote: Uint8Array;
  nonceHex: string;
} {
  if (
    !Number.isSafeInteger(partyId) ||
    partyId < 0
  ) {
    throw new Error(
      "หมายเลขพรรคไม่ถูกต้อง"
    );
  }

  if (
    encryptionPublicKey.length !== 32
  ) {
    throw new Error(
      "Election encryption public key ต้องมี 32 bytes"
    );
  }

  /*
   * Plaintext:
   *
   * party_id = uint64 little endian
   */

  const ballot =
    new Uint8Array(8);

  const view =
    new DataView(
      ballot.buffer
    );

  view.setBigUint64(
    0,
    BigInt(partyId),
    true
  );

  /*
   * Generate ephemeral keypair
   */

  const ephemeralKeypair =
    nacl.box.keyPair();

  /*
   * Generate nonce
   */

  const nonce =
    nacl.randomBytes(
      nacl.box.nonceLength
    );

  /*
   * Encrypt:
   *
   * nacl.box(
   *   plaintext,
   *   nonce,
   *   electionPublicKey,
   *   ephemeralSecretKey
   * )
   */

  const ciphertext =
    nacl.box(
      ballot,
      nonce,
      encryptionPublicKey,
      ephemeralKeypair.secretKey
    );

  if (!ciphertext) {
    throw new Error(
      "ไม่สามารถเข้ารหัส ballot ได้"
    );
  }

  /*
   * Final format:
   *
   * [ephemeral public key 32]
   * [nonce               24]
   * [ciphertext           24]
   *
   * Total = 80 bytes
   */

  const encryptedVote =
    new Uint8Array(
      32 +
      24 +
      ciphertext.length
    );

  encryptedVote.set(
    ephemeralKeypair.publicKey,
    0
  );

  encryptedVote.set(
    nonce,
    32
  );

  encryptedVote.set(
    ciphertext,
    32 + 24
  );

  if (
    encryptedVote.length !== 80
  ) {
    throw new Error(
      `Encrypted vote มีขนาด ${encryptedVote.length} bytes แต่ควรเป็น 80 bytes`
    );
  }

  /*
   * nonce -> hex
   *
   * เก็บไว้ให้ user ใช้ reveal ภายหลัง
   */

  const nonceHex =
    Array.from(nonce)
      .map(
        (byte) =>
          byte
            .toString(16)
            .padStart(2, "0")
      )
      .join("");

  return {
    encryptedVote,
    nonceHex,
  };
}


/* =========================================================
   SUBMIT VOTE COMMIT
========================================================= */

export async function submitVoteCommit(
  params: VoteCommitParams
): Promise<VoteCommitResult> {
  const {
    walletProvider,
    election,
    partyId,
  } = params;

  if (!walletProvider) {
    throw new Error(
      "ไม่พบ Phantom wallet"
    );
  }

  if (
    !walletProvider.publicKey
  ) {
    throw new Error(
      "กรุณาเชื่อมต่อ Phantom wallet ก่อนโหวต"
    );
  }

  const wallet =
    walletProvider.publicKey;

  /*
   * Determine election ID from the
   * election account.
   *
   * The current application uses:
   *
   * ELECTION_ID = 6
   */

  const ELECTION_ID = 6;

  const [
    electionPda,
  ] = getElectionPda(
    ELECTION_ID
  );

  /*
   * Make sure the supplied election
   * address is the correct PDA.
   */

  if (
    !election.equals(
      electionPda
    )
  ) {
    throw new Error(
      "Election address ไม่ตรงกับ ELECTION_ID"
    );
  }

  /*
   * ---------------------------------------------------------
   * CHECK ELECTION
   * ---------------------------------------------------------
   */

  await checkElectionTime(
    electionPda
  );

  /*
   * ---------------------------------------------------------
   * CHECK VOTER
   * ---------------------------------------------------------
   */

  await checkVoter(
    ELECTION_ID,
    wallet,
    electionPda
  );

  /*
   * ---------------------------------------------------------
   * CHECK PARTY
   * ---------------------------------------------------------
   */

  await checkPartyExists(
    ELECTION_ID,
    partyId,
    electionPda
  );

  /*
   * ---------------------------------------------------------
   * READ ENCRYPTION KEY
   * ---------------------------------------------------------
   */

  const encryptionPublicKey =
    await getElectionEncryptionKey(
      ELECTION_ID,
      electionPda
    );

  /*
   * ---------------------------------------------------------
   * CREATE ENCRYPTED BALLOT
   * ---------------------------------------------------------
   */

  const {
    encryptedVote,
    nonceHex,
  } =
    createEncryptedBallot(
      partyId,
      encryptionPublicKey
    );

  /*
   * ---------------------------------------------------------
   * DERIVE VOTE PDA
   * ---------------------------------------------------------
   */

  const [
    votePda,
  ] = getVotePda(
    ELECTION_ID,
    wallet
  );

  /*
   * Check if vote account already exists.
   */

  const existingVote =
    await connection.getAccountInfo(
      votePda
    );

  if (existingVote) {
    throw new Error(
      "Wallet นี้มี Vote account อยู่แล้ว ไม่สามารถโหวตซ้ำได้"
    );
  }

  /*
   * ---------------------------------------------------------
   * CREATE ANCHOR PROGRAM
   * ---------------------------------------------------------
   */

  const program =
    getVoteProgram(
      walletProvider
    );

  /*
   * ---------------------------------------------------------
   * SUBMIT
   * ---------------------------------------------------------
   *
   * IMPORTANT:
   *
   * We send ONLY:
   *
   *   election_id
   *   encrypted_vote
   *
   * partyId is NOT sent as plaintext.
   *
   * ---------------------------------------------------------
   */

  const tx =
    await program.methods
      .vote(
        new anchor.BN(
          ELECTION_ID
        ),
        Buffer.from(
          encryptedVote
        )
      )
      .accounts({
        voterWallet: wallet,
      })
      .rpc();

  /*
   * ---------------------------------------------------------
   * SAVE NONCE LOCALLY
   * ---------------------------------------------------------
   *
   * This is only a convenience backup.
   * The nonce is also returned to the UI.
   */

  try {
    const storageKey =
      `blockvote:nonce:${ELECTION_ID}:${wallet.toBase58()}`;

    localStorage.setItem(
      storageKey,
      nonceHex
    );
  } catch {
    // localStorage may be unavailable.
  }

  /*
   * ---------------------------------------------------------
   * SUCCESS
   * ---------------------------------------------------------
   */

  return {
    tx,
    nonceHex,
    encryptedVoteBase64:
      Buffer.from(
        encryptedVote
      ).toString("base64"),
  };
}