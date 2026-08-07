/**
 * Server-only Solana client that signs transactions as the program's
 * admin authority (needed for register_voter, which requires
 * config.authority to sign). NEVER import this from a "use client"
 * component — ADMIN_PRIVATE_KEY must never reach the browser.
 *
 * Builds the wallet object by hand (publicKey + signTransaction +
 * signAllTransactions) instead of importing @coral-xyz/anchor's
 * `Wallet` class — that named export isn't reliably present across
 * versions/bundlers, but this is exactly the interface AnchorProvider
 * actually requires, so it works regardless.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "@/lib/idl/blockvote.json";

let adminProgramSingleton: Program | null = null;
let adminKeypairSingleton: Keypair | null = null;

function loadAdminKeypair(): Keypair {
  if (adminKeypairSingleton) return adminKeypairSingleton;

  const secret = process.env.ADMIN_PRIVATE_KEY;
  if (!secret) {
    throw new Error("ADMIN_PRIVATE_KEY is not set on the server");
  }

  adminKeypairSingleton = Keypair.fromSecretKey(bs58.decode(secret));
  return adminKeypairSingleton;
}

function getAdminProgram(): Program {
  if (adminProgramSingleton) return adminProgramSingleton;

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  const adminKeypair = loadAdminKeypair();

  const wallet = {
    publicKey: adminKeypair.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      tx: T
    ): Promise<T> {
      if (tx instanceof VersionedTransaction) {
        tx.sign([adminKeypair]);
      } else {
        tx.partialSign(adminKeypair);
      }
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      txs: T[]
    ): Promise<T[]> {
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

  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });

  adminProgramSingleton = new Program(idl as Idl, provider);
  return adminProgramSingleton;
}

function deriveVoterPda(walletAddress: string): PublicKey {
  const program = getAdminProgram();
  const voterWallet = new PublicKey(walletAddress);

  const [voterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("voter"), voterWallet.toBuffer()],
    program.programId
  );

  return voterPda;
}

export async function isVoterAlreadyRegistered(
  walletAddress: string
): Promise<boolean> {
  const program = getAdminProgram();
  const voterPda = deriveVoterPda(walletAddress);
  const info = await program.provider.connection.getAccountInfo(voterPda);
  return info !== null;
}

/**
 * Calls register_voter signed by the admin authority. Matches the
 * account pattern already proven working in tests/register_voter.ts:
 * "config" and "voter" are PDAs the IDL can auto-resolve, only
 * "authority" and "voter_wallet" need to be passed explicitly.
 */
export async function registerVoterOnChain(
  walletAddress: string
): Promise<string> {
  const program = getAdminProgram();
  const adminKeypair = loadAdminKeypair();
  const voterWallet = new PublicKey(walletAddress);

  const tx = await program.methods
    .registerVoter()
    .accounts({
      authority: adminKeypair.publicKey,
      voterWallet,
    })
    .rpc();

  return tx;
}