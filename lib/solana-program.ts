/**
 * Read-only Anchor program client for fetching on-chain BlockVote data
 * (elections, parties, results) without needing a connected wallet.
 * Uses a throwaway keypair to satisfy AnchorProvider's Wallet interface
 * — it's never used to sign anything, only .fetch()/.all() calls run
 * through this client.
 */

import { Connection, clusterApiUrl, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import idl from "./idl/blockvote.json";
import bs58 from "bs58";

let programSingleton: Program | null = null;

export function getReadOnlyProgram(): Program {
  if (programSingleton) return programSingleton;

  const connection = new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  const dummyWallet = {
    publicKey: Keypair.generate().publicKey,
    signTransaction: async () => {
      throw new Error("Read-only client cannot sign transactions");
    },
    signAllTransactions: async () => {
      throw new Error("Read-only client cannot sign transactions");
    },
  };

  const provider = new AnchorProvider(connection, dummyWallet as any, {
    commitment: "confirmed",
  });

  programSingleton = new Program(idl as Idl, provider);
  return programSingleton;
}

export function deriveElectionPda(electionId: number): PublicKey {
  const program = getReadOnlyProgram();
  const idBuffer = Buffer.from(
  new BigUint64Array([BigInt(electionId)]).buffer
  );

  const [electionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("election"), idBuffer],
    program.programId
  );

  return electionPda;
}

/**
 * Derives the Voter PDA for a given wallet address. Uses the same
 * seed pattern ("voter" + wallet pubkey) as lib/solana-admin.ts's
 * server-side deriveVoterPda — keep both in sync if the on-chain
 * seeds ever change.
 */
export function deriveVoterPda(walletAddress: string): PublicKey {
  const program = getReadOnlyProgram();
  const voterWallet = new PublicKey(walletAddress);

  const [voterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("voter"), voterWallet.toBuffer()],
    program.programId
  );

  return voterPda;
}

/**
 * Checks whether a wallet already has a registered Voter account
 * on-chain. Safe to call from client components (read-only).
 */
export async function isVoterRegistered(
  walletAddress: string
): Promise<boolean> {
  try {
    const program = getReadOnlyProgram();
    const voterPda = deriveVoterPda(walletAddress);
    const info = await program.provider.connection.getAccountInfo(voterPda);
    return info !== null;
  } catch (err) {
    console.error("isVoterRegistered failed", err);
    return false;
  }
}

export interface VoterStatus {
  verified: boolean;
  hasVoted: boolean;
}

/**
 * Fetches the deserialized Voter account (verified + has_voted) for a
 * wallet, or null if no Voter account exists yet. Use this (instead
 * of isVoterRegistered) anywhere that needs to know has_voted, e.g.
 * to disable the vote button after a wallet has already committed a
 * vote — has_voted is set on-chain by vote_commit itself, so this
 * reflects real chain state and can't be bypassed client-side.
 */
export async function fetchVoterStatus(
  walletAddress: string
): Promise<VoterStatus | null> {
  try {
    const program: any = getReadOnlyProgram();
    const voterPda = deriveVoterPda(walletAddress);
    const account = await program.account.voter.fetch(voterPda);
    return {
      verified: Boolean(account.verified),
      hasVoted: Boolean(account.hasVoted),
    };
  } catch (err) {
    // Account doesn't exist yet, or fetch failed — treat as "no status".
    return null;
  }
}

export interface PartyData {
  id: number;
  election: PublicKey;
  name: string;
  logoUrl: string;
  voteCount: number;
  address: PublicKey;
}

export interface ElectionData {
  id: number;
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  status: string;
  partyCount: number;
  totalVotes: number;
}

export async function fetchElection(
  electionId: number
): Promise<{ address: PublicKey; data: ElectionData } | null> {
  const program: any = getReadOnlyProgram();
  const electionPda = deriveElectionPda(electionId);

  try {
    const account: any = await program.account.election.fetch(electionPda);
    return {
      address: electionPda,
      data: {
        id: Number(account.id),
        title: account.title,
        description: account.description,
        startTime: Number(account.startTime),
        endTime: Number(account.endTime),
        status: Object.keys(account.status)[0],
        partyCount: account.partyCount,
        totalVotes: Number(account.totalVotes),
      },
    };
  } catch (err) {
    console.error("fetchElection failed", err);
    return null;
  }
}

export async function fetchPartiesForElection(
  electionPda: PublicKey
): Promise<PartyData[]> {
  const program = getReadOnlyProgram();

  const PARTY_DISCRIMINATOR = Buffer.from([
    208, 64, 165, 146, 114, 138, 161, 100,
  ]);

  const accounts: any[] = await (program.account as any).party.all([
    {
      memcmp: {
        offset: 8 + 2, // discriminator + party.id(u16)
        bytes: electionPda.toBase58(),
      },
    },
  ]);

  return accounts
    .map((p) => ({
      id: p.account.id,
      election: p.account.election,
      name: p.account.name,
      logoUrl: p.account.logoUrl,
      voteCount: Number(p.account.voteCount),
      address: p.publicKey,
    }))
    .sort((a, b) => a.id - b.id);
}