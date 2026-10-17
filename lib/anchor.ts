import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import idl from "./idl/blockvote.json";

export const PROGRAM_ID = new PublicKey(
  "28Pb8bp4T6Eb1pRNVYe6BUS3PRHjyr1wsha2PA4sn9Lj"
);

export const RPC_ENDPOINT =
  "https://api.devnet.solana.com";

export const connection = new Connection(
  RPC_ENDPOINT,
  "confirmed"
);

export const BLOCKVOTE_IDL = idl;


/* ============================================================
   PHANTOM WALLET PROVIDER
============================================================ */

export interface PhantomWalletProvider {
  isPhantom?: boolean;

  publicKey?: PublicKey;

  connect: (options?: {
    onlyIfTrusted?: boolean;
  }) => Promise<{
    publicKey: PublicKey;
  }>;

  disconnect: () => Promise<void>;

  signTransaction: (
    transaction: Transaction
  ) => Promise<Transaction>;

  signAllTransactions: (
    transactions: Transaction[]
  ) => Promise<Transaction[]>;

  on: (
    event: string,
    callback: (
      publicKey: PublicKey | null
    ) => void
  ) => void;

  removeListener: (
    event: string,
    callback: (
      publicKey: PublicKey | null
    ) => void
  ) => void;
}


/* ============================================================
   ANCHOR WALLET ADAPTER
============================================================ */

/*
 * Do NOT use:
 *
 *   implements anchor.Wallet
 *
 * with the current Anchor version.
 *
 * In this version, anchor.Wallet resolves to a class/type
 * that expects a payer property. Phantom already owns the
 * signing operation, so we provide the wallet interface
 * structurally and cast it when passing it to AnchorProvider.
 */

export class PhantomAnchorWallet {
  constructor(
    private readonly provider: PhantomWalletProvider
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
    return await this.provider.signAllTransactions(
      transactions
    );
  }
}


/* ============================================================
   GET PROGRAM
============================================================ */

export function getProgram(wallet: PhantomAnchorWallet): any {
  const provider =
    new anchor.AnchorProvider(
      connection,
      wallet as unknown as anchor.Wallet,
      {
        commitment: "confirmed",
      }
    );

  return new anchor.Program(
    BLOCKVOTE_IDL as anchor.Idl,
    provider
  );
}


/* ============================================================
   U64 BUFFER
============================================================ */

/*
 * Browser-safe replacement for Buffer.writeBigUInt64LE().
 *
 * Anchor PDA seeds use little-endian u64 values.
 */

function u64Buffer(
  value: number | bigint
): Uint8Array {
  const n = BigInt(value);

  if (n < 0n) {
    throw new Error(
      "u64 value cannot be negative."
    );
  }

  const buffer = new ArrayBuffer(8);

  const view =
    new DataView(buffer);

  view.setBigUint64(
    0,
    n,
    true
  );

  return new Uint8Array(buffer);
}


/* ============================================================
   ELECTION PDA
============================================================ */

export function getElectionPda(
  electionId: number | bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("election"),
      Buffer.from(
        u64Buffer(electionId)
      ),
    ],
    PROGRAM_ID
  );
}


/* ============================================================
   PARTY PDA
============================================================ */

export function getPartyPda(
  electionId: number | bigint,
  partyId: number | bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("party"),
      Buffer.from(
        u64Buffer(electionId)
      ),
      Buffer.from(
        u64Buffer(partyId)
      ),
    ],
    PROGRAM_ID
  );
}


/* ============================================================
   ELECTION CRYPTO PDA
============================================================ */

export function getElectionCryptoPda(
  electionId: number | bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(
        "election_crypto"
      ),
      Buffer.from(
        u64Buffer(electionId)
      ),
    ],
    PROGRAM_ID
  );
}


/* ============================================================
   ELECTION RESULT PDA (สร้างตอน reveal_results)
============================================================ */

export function getElectionResultPda(
  electionId: number | bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("election_result"),
      Buffer.from(
        u64Buffer(electionId)
      ),
    ],
    PROGRAM_ID
  );
}


/* ============================================================
   VOTER PDA
============================================================ */

export function getVoterPda(
  electionId: number | bigint,
  voterWallet: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("voter"),
      Buffer.from(
        u64Buffer(electionId)
      ),
      voterWallet.toBuffer(),
    ],
    PROGRAM_ID
  );
}


/* ============================================================
   VOTE PDA
============================================================ */

export function getVotePda(
  electionId: number | bigint,
  voterWallet: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("vote"),
      Buffer.from(
        u64Buffer(electionId)
      ),
      voterWallet.toBuffer(),
    ],
    PROGRAM_ID
  );
}