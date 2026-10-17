import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// ============================================================
// LOAD .env.local
// ============================================================

const envPath = path.resolve(
  process.cwd(),
  ".env.local"
);

const envResult = dotenv.config({
  path: envPath,
});

if (envResult.error) {
  console.error("");
  console.error("========================================");
  console.error("                ERROR");
  console.error("========================================");
  console.error("");
  console.error("Failed to load .env.local");
  console.error(`Expected file: ${envPath}`);
  console.error("");

  process.exit(1);
}

// ============================================================
// IMPORTS
// ============================================================

import * as anchor from "@coral-xyz/anchor";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import BN from "bn.js";

import nacl from "tweetnacl";

import bs58 from "bs58";

// ============================================================
// CONFIG
// ============================================================

const PROGRAM_ID = new PublicKey(
  "28Pb8bp4T6Eb1pRNVYe6BUS3PRHjyr1wsha2PA4sn9Lj"
);

const RPC_ENDPOINT =
  process.env.SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

const ADMIN_PRIVATE_KEY =
  process.env.ADMIN_PRIVATE_KEY?.trim();

const ELECTION_ID = Number(
  process.argv[2] || "6"
);

// ============================================================
// EXPECTED ADMIN
// ============================================================

const EXPECTED_ADMIN =
  "Fo2UJytmzSxKCV9gnu1YE2aWsZqDBN6XaKDdhwckiTYV";

// ============================================================
// VALIDATE
// ============================================================

if (!ADMIN_PRIVATE_KEY) {
  console.error("");
  console.error("========================================");
  console.error("                ERROR");
  console.error("========================================");
  console.error("");
  console.error(
    "ADMIN_PRIVATE_KEY is not set in .env.local"
  );
  console.error("");
  console.error(
    `Expected file: ${envPath}`
  );
  console.error("");

  process.exit(1);
}

if (
  !Number.isInteger(ELECTION_ID) ||
  ELECTION_ID < 0
) {
  console.error("");
  console.error(
    `Invalid election ID: ${ELECTION_ID}`
  );
  console.error("");

  process.exit(1);
}

// ============================================================
// LOAD ADMIN KEYPAIR
// ============================================================

function loadAdminKeypair(): Keypair {
  const secret = ADMIN_PRIVATE_KEY!;

  // ----------------------------------------------------------
  // JSON ARRAY
  // ----------------------------------------------------------

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
          `ADMIN_PRIVATE_KEY must contain 64 or 32 bytes, got ${parsed.length}`
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

      return Keypair.fromSecretKey(
        Uint8Array.from(parsed)
      );
    } catch (error) {
      throw new Error(
        [
          "Invalid ADMIN_PRIVATE_KEY JSON array:",
          error instanceof Error
            ? error.message
            : String(error),
        ].join(" ")
      );
    }
  }

  // ----------------------------------------------------------
  // BASE58
  // ----------------------------------------------------------

  try {
    const secretKey = bs58.decode(
      secret
    );

    return Keypair.fromSecretKey(
      secretKey
    );
  } catch {
    throw new Error(
      "ADMIN_PRIVATE_KEY must be either a Base58 private key or a JSON byte array"
    );
  }
}

// ============================================================
// LOAD IDL
// ============================================================

function loadIdl(): any {
  const possiblePaths = [
    path.resolve(
      process.cwd(),
      "target",
      "idl",
      "blockvote.json"
    ),

    path.resolve(
      process.cwd(),
      "lib",
      "idl",
      "blockvote.json"
    ),
  ];

  for (
    const filePath of possiblePaths
  ) {
    if (fs.existsSync(filePath)) {
      console.log("");
      console.log(
        `IDL: ${filePath}`
      );

      return JSON.parse(
        fs.readFileSync(
          filePath,
          "utf8"
        )
      );
    }
  }

  throw new Error(
    [
      "BlockVote IDL not found.",
      "",
      "Checked:",
      ...possiblePaths.map(
        (p) => `- ${p}`
      ),
    ].join("\n")
  );
}

// ============================================================
// U64 BUFFER
// ============================================================

function u64Buffer(
  value: number | bigint
): Buffer {
  const n = BigInt(value);

  if (n < 0n) {
    throw new Error(
      "u64 cannot be negative"
    );
  }

  const buffer = Buffer.alloc(8);

  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  view.setBigUint64(
    0,
    n,
    true
  );

  return buffer;
}

// ============================================================
// ELECTION PDA
// ============================================================

function getElectionPda(
  electionId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("election"),
      u64Buffer(electionId),
    ],
    PROGRAM_ID
  );
}

// ============================================================
// ELECTION CRYPTO PDA
// ============================================================

function getElectionCryptoPda(
  electionId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(
        "election_crypto"
      ),
      u64Buffer(electionId),
    ],
    PROGRAM_ID
  );
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  // ----------------------------------------------------------
  // HEADER
  // ----------------------------------------------------------

  console.log(
    "========================================"
  );

  console.log(
    "   BlockVote - INIT ELECTION CRYPTO"
  );

  console.log(
    "========================================"
  );

  console.log("");

  console.log(
    `Program: ${PROGRAM_ID.toBase58()}`
  );

  console.log(
    `RPC: ${RPC_ENDPOINT}`
  );

  console.log(
    `Election ID: ${ELECTION_ID}`
  );

  console.log("");

  // ----------------------------------------------------------
  // ADMIN
  // ----------------------------------------------------------

  const admin =
    loadAdminKeypair();

  console.log(
    `Admin: ${admin.publicKey.toBase58()}`
  );

  // ----------------------------------------------------------
  // VERIFY ADMIN
  // ----------------------------------------------------------

  if (
    admin.publicKey.toBase58() !==
    EXPECTED_ADMIN
  ) {
    throw new Error(
      [
        "",
        "WRONG ADMIN WALLET!",
        "",
        `Expected: ${EXPECTED_ADMIN}`,
        `Got:      ${admin.publicKey.toBase58()}`,
        "",
        "Make sure ADMIN_PRIVATE_KEY in .env.local",
        "belongs to the BlockVote admin wallet.",
      ].join("\n")
    );
  }

  // ----------------------------------------------------------
  // CONNECTION
  // ----------------------------------------------------------

  const connection =
    new Connection(
      RPC_ENDPOINT,
      "confirmed"
    );

  // ----------------------------------------------------------
  // ADMIN BALANCE
  // ----------------------------------------------------------

  const balance =
    await connection.getBalance(
      admin.publicKey
    );

  console.log(
    `Admin balance: ${(
      balance /
      anchor.web3.LAMPORTS_PER_SOL
    ).toFixed(9)} SOL`
  );

  if (balance === 0) {
    throw new Error(
      "Admin wallet has 0 SOL. Fund it on Solana Devnet first."
    );
  }

  // ----------------------------------------------------------
  // LOAD IDL
  // ----------------------------------------------------------

  const idl =
    loadIdl();

  // ----------------------------------------------------------
  // CREATE PROVIDER
  // ----------------------------------------------------------

  const wallet =
    new anchor.Wallet(
      admin
    );

  const provider =
    new anchor.AnchorProvider(
      connection,
      wallet,
      {
        commitment:
          "confirmed",
      }
    );

  anchor.setProvider(
    provider
  );

  // ----------------------------------------------------------
  // CREATE PROGRAM
  // ----------------------------------------------------------

  const program =
    new anchor.Program(
      idl,
      provider
    );

  // ----------------------------------------------------------
  // ELECTION PDA
  // ----------------------------------------------------------

  const [electionPda] =
    getElectionPda(
      ELECTION_ID
    );

  console.log("");

  console.log(
    `Election PDA: ${electionPda.toBase58()}`
  );

  // ----------------------------------------------------------
  // CHECK ELECTION
  // ----------------------------------------------------------

  const electionAccount =
    await connection.getAccountInfo(
      electionPda
    );

  if (!electionAccount) {
    throw new Error(
      [
        "",
        "Election does not exist!",
        "",
        `Election ID: ${ELECTION_ID}`,
        `Election PDA: ${electionPda.toBase58()}`,
        "",
        "Create the election first.",
      ].join("\n")
    );
  }

  console.log(
    "Election exists: YES"
  );

  // ----------------------------------------------------------
  // ELECTION CRYPTO PDA
  // ----------------------------------------------------------

  const [
    electionCryptoPda,
  ] =
    getElectionCryptoPda(
      ELECTION_ID
    );

  console.log("");

  console.log(
    `Election Crypto PDA: ${electionCryptoPda.toBase58()}`
  );

  // ----------------------------------------------------------
  // CHECK EXISTING ELECTION CRYPTO
  // ----------------------------------------------------------

  const existingCrypto =
    await connection.getAccountInfo(
      electionCryptoPda
    );

  if (existingCrypto) {
    console.log("");

    console.log(
      "Election Crypto already exists."
    );

    console.log(
      "No initialization is needed."
    );

    console.log("");

    console.log(
      "========================================"
    );

    console.log(
      "              ALREADY DONE"
    );

    console.log(
      "========================================"
    );

    console.log("");

    return;
  }

  console.log(
    "Election Crypto exists: NO"
  );

  // ----------------------------------------------------------
  // GENERATE ENCRYPTION KEYPAIR
  // ----------------------------------------------------------

  console.log("");

  console.log(
    "Generating election encryption keypair..."
  );

  const keyPair =
    nacl.box.keyPair();

  const publicKey =
    keyPair.publicKey;

  const secretKey =
    keyPair.secretKey;

  console.log(
    `Public key: ${Buffer.from(
      publicKey
    ).toString("base64")}`
  );

  // ----------------------------------------------------------
  // KEY DIRECTORY
  // ----------------------------------------------------------

  const homeDir =
    process.env.USERPROFILE ||
    process.env.HOME ||
    process.cwd();

  const keyDirectory =
    path.join(
      homeDir,
      ".blockvote",
      "keys"
    );

  fs.mkdirSync(
    keyDirectory,
    {
      recursive: true,
    }
  );

  // ----------------------------------------------------------
  // KEY FILE
  // ----------------------------------------------------------

  const keyFile =
    path.join(
      keyDirectory,
      `election-${ELECTION_ID}.json`
    );

  const keyFileData = {
    electionId:
      ELECTION_ID,

    publicKey:
      Buffer.from(
        publicKey
      ).toString("base64"),

    secretKey:
      Array.from(
        secretKey
      ),

    createdAt:
      new Date().toISOString(),
  };

  fs.writeFileSync(
    keyFile,
    JSON.stringify(
      keyFileData,
      null,
      2
    ),
    {
      encoding: "utf8",
    }
  );

  console.log("");

  console.log(
    `Secret key saved to: ${keyFile}`
  );

  console.log("");

  console.log(
    "IMPORTANT: DO NOT upload this file to GitHub."
  );

  console.log(
    "IMPORTANT: DO NOT send this secret key to anyone."
  );

  // ----------------------------------------------------------
  // INITIALIZE ELECTION CRYPTO
  // ----------------------------------------------------------

  console.log("");

  console.log(
    "Initializing Election Crypto on-chain..."
  );

  console.log("");

  try {
    // IMPORTANT:
    // Anchor's Borsh encoder expects a BN-compatible
    // object for u64. Do NOT use BigInt here.

    const electionIdBN =
      new BN(
        ELECTION_ID
      );

    console.log(
      `Election ID BN: ${electionIdBN.toString()}`
    );

    // --------------------------------------------------------
    // BUILD + SEND TRANSACTION
    // --------------------------------------------------------

    const tx =
      await program.methods
        .initializeElectionCrypto(
          electionIdBN,
          Array.from(
            publicKey
          )
        )
        .accounts({
          admin:
            admin.publicKey,

          election:
            electionPda,

          electionCrypto:
            electionCryptoPda,

          systemProgram:
            SystemProgram.programId,
        })
        .rpc();

    // --------------------------------------------------------
    // TRANSACTION SUCCESS
    // --------------------------------------------------------

    console.log("");

    console.log(
      "Transaction successful!"
    );

    console.log(
      `Transaction: ${tx}`
    );

    // --------------------------------------------------------
    // VERIFY ACCOUNT
    // --------------------------------------------------------

    console.log("");

    console.log(
      "Verifying Election Crypto account..."
    );

    const initializedAccount =
      await connection.getAccountInfo(
        electionCryptoPda
      );

    if (!initializedAccount) {
      throw new Error(
        "Transaction succeeded but Election Crypto account was not found."
      );
    }

    console.log(
      "Election Crypto account verified."
    );

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    console.log("");

    console.log(
      "========================================"
    );

    console.log(
      "              SUCCESS"
    );

    console.log(
      "========================================"
    );

    console.log("");

    console.log(
      `Election ID: ${ELECTION_ID}`
    );

    console.log(
      `Election PDA: ${electionPda.toBase58()}`
    );

    console.log(
      `Election Crypto PDA: ${electionCryptoPda.toBase58()}`
    );

    console.log(
      `Public key: ${Buffer.from(
        publicKey
      ).toString("base64")}`
    );

    console.log(
      `Key file: ${keyFile}`
    );

    console.log(
      `Transaction: ${tx}`
    );

    console.log("");

    console.log(
      "The election encryption key is now initialized."
    );

    console.log(
      "You can now test voting from /vote."
    );

    console.log("");
  } catch (error) {
    // --------------------------------------------------------
    // FAILED
    // --------------------------------------------------------

    console.error("");

    console.error(
      "On-chain initialization failed."
    );

    console.error("");

    // --------------------------------------------------------
    // REMOVE KEY FILE
    // --------------------------------------------------------

    if (
      fs.existsSync(
        keyFile
      )
    ) {
      try {
        fs.unlinkSync(
          keyFile
        );

        console.error(
          "Generated key file was removed because initialization failed."
        );
      } catch (cleanupError) {
        console.error(
          "Could not remove generated key file:"
        );

        console.error(
          cleanupError
        );
      }
    }

    throw error;
  }
}

// ============================================================
// RUN
// ============================================================

main().catch(
  (error) => {
    console.error("");

    console.error(
      "========================================"
    );

    console.error(
      "                ERROR"
    );

    console.error(
      "========================================"
    );

    console.error("");

    if (
      error instanceof Error
    ) {
      console.error(
        error.message
      );

      if (error.stack) {
        console.error("");

        console.error(
          error.stack
        );
      }
    } else {
      console.error(
        error
      );
    }

    console.error("");

    process.exit(1);
  }
);