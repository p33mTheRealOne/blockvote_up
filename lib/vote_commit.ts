/**
 * Client-side helper for submitting vote_commit, signed by the
 * connected Phantom wallet (never a filesystem keypair — this runs
 * in the browser). Mirrors tests/vote_commit.ts but:
 *   - uses window.solana (Phantom) as the signer via AnchorProvider,
 *     instead of AnchorProvider.env()
 *   - uses Web Crypto (crypto.subtle / crypto.getRandomValues)
 *     instead of node's `crypto` module, which isn't available in
 *     the browser
 */

import { Connection, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import idl from "./idl/blockvote.json";

interface PhantomProvider {
  publicKey: PublicKey;
  signTransaction: (tx: any) => Promise<any>;
  signAllTransactions: (txs: any[]) => Promise<any[]>;
}

function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return nonce;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer;

  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return new Uint8Array(digest);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** party_id -> 2-byte little-endian buffer, same as partyBuffer in the CLI script */
function encodePartyIdLE(partyId: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, partyId, true);
  return buf;
}

function getProgramWithWallet(walletProvider: PhantomProvider): Program {
  const connection = new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  const wallet = {
    publicKey: walletProvider.publicKey,
    signTransaction: walletProvider.signTransaction.bind(walletProvider),
    signAllTransactions: walletProvider.signAllTransactions.bind(walletProvider),
  };

  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });

  return new Program(idl as Idl, provider);
}

/** Key used to back up the nonce in localStorage, per election + wallet */
function nonceStorageKey(election: PublicKey, walletAddress: string): string {
  return `blockvote:nonce:${election.toBase58()}:${walletAddress}`;
}

export interface VoteCommitResult {
  tx: string;
  nonceHex: string;
}

/**
 * Submits vote_commit for the connected wallet. Generates a fresh
 * random nonce, hashes commitment = sha256(partyId_LE || nonce),
 * sends the tx signed by Phantom, and backs the nonce up to
 * localStorage (best-effort — the caller should still show it to the
 * user to save, since this can be cleared or is device-local only).
 */
export async function submitVoteCommit(params: {
  walletProvider: PhantomProvider;
  election: PublicKey;
  partyId: number;
}): Promise<VoteCommitResult> {
  const { walletProvider, election, partyId } = params;

  if (!walletProvider?.publicKey) {
    throw new Error("Wallet not connected");
  }

  const program = getProgramWithWallet(walletProvider);

  const nonce = generateNonce();
  const partyBuffer = encodePartyIdLE(partyId);

  const combined = new Uint8Array(partyBuffer.length + nonce.length);
  combined.set(partyBuffer, 0);
  combined.set(nonce, partyBuffer.length);

  const commitmentBytes = await sha256(combined);
  const commitment = Array.from(commitmentBytes);

  const tx = await program.methods
    .voteCommit(commitment)
    .accounts({
      voterWallet: walletProvider.publicKey,
      election,
    })
    .rpc();

  const nonceHex = toHex(nonce);

  try {
    localStorage.setItem(
      nonceStorageKey(election, walletProvider.publicKey.toBase58()),
      nonceHex
    );
  } catch {
    // localStorage unavailable (private mode, etc.) — non-fatal,
    // caller-shown nonce is still the source of truth.
  }

  return { tx, nonceHex };
}

/** Reads back a locally-backed-up nonce, if one exists for this election + wallet. */
export function getStoredNonce(
  election: PublicKey,
  walletAddress: string
): string | null {
  try {
    return localStorage.getItem(nonceStorageKey(election, walletAddress));
  } catch {
    return null;
  }
}