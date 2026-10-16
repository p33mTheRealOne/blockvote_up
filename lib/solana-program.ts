import { Connection, PublicKey } from "@solana/web3.js";

import {
  PROGRAM_ID,
  RPC_ENDPOINT,
  getElectionPda,
  getPartyPda,
  getVoterPda,
} from "@/lib/anchor";

/* =========================================================
   CONFIG
========================================================= */

export const ELECTION_ID = 6;

const connection = new Connection(
  RPC_ENDPOINT,
  "confirmed"
);

/* =========================================================
   TYPES
========================================================= */

export type ElectionData = {
  admin: PublicKey;
  electionId: bigint;
  name: string;
  description: string;
  startUnix: bigint;
  endUnix: bigint;
  bump: number;
  status: number;
};

export type ElectionResult = {
  address: PublicKey;
  data: ElectionData;
};

export type PartyData = {
  address: PublicKey;
  election: PublicKey;
  partyId: bigint;
  name: string;
  logoUrl: string;
  bump: number;
};

export type VoterStatus = {
  verified: boolean;
  hasVoted: boolean;
  address: PublicKey;
};

/* =========================================================
   BYTE READER
========================================================= */

class ByteReader {
  private data: Uint8Array;
  private offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  private ensure(length: number) {
    if (
      this.offset + length >
      this.data.length
    ) {
      throw new Error(
        `Invalid account data: need ${length} bytes at offset ${this.offset}, total ${this.data.length}`
      );
    }
  }

  readU8(): number {
    this.ensure(1);

    const value =
      this.data[this.offset];

    this.offset += 1;

    return value;
  }

  readU32(): number {
    this.ensure(4);

    const view = new DataView(
      this.data.buffer,
      this.data.byteOffset +
        this.offset,
      4
    );

    const value =
      view.getUint32(0, true);

    this.offset += 4;

    return value;
  }

  readU64(): bigint {
    this.ensure(8);

    const view = new DataView(
      this.data.buffer,
      this.data.byteOffset +
        this.offset,
      8
    );

    const value =
      view.getBigUint64(0, true);

    this.offset += 8;

    return value;
  }

  readI64(): bigint {
    this.ensure(8);

    const view = new DataView(
      this.data.buffer,
      this.data.byteOffset +
        this.offset,
      8
    );

    const value =
      view.getBigInt64(0, true);

    this.offset += 8;

    return value;
  }

  readPublicKey(): PublicKey {
    this.ensure(32);

    const bytes =
      this.data.slice(
        this.offset,
        this.offset + 32
      );

    this.offset += 32;

    return new PublicKey(bytes);
  }

  readString(): string {
    const length =
      this.readU32();

    this.ensure(length);

    const bytes =
      this.data.slice(
        this.offset,
        this.offset + length
      );

    this.offset += length;

    return new TextDecoder().decode(
      bytes
    );
  }
}

/* =========================================================
   FETCH ELECTION
========================================================= */

export async function fetchElection(
  electionId: number | bigint =
    ELECTION_ID
): Promise<ElectionResult | null> {
  try {
    /*
     * getElectionPda() returns:
     *
     * [PublicKey, bump]
     */
    const [electionAddress] =
      getElectionPda(electionId);

    const accountInfo =
      await connection.getAccountInfo(
        electionAddress
      );

    if (!accountInfo) {
      return null;
    }

    /*
     * Election account layout:
     *
     * discriminator  8
     * admin         32
     * election_id    8
     * name          4 + string
     * description   4 + string
     * start_unix    8
     * end_unix      8
     * bump           1
     * status         1
     */

    const reader =
      new ByteReader(
        accountInfo.data
      );

    // Skip Anchor discriminator
    for (let i = 0; i < 8; i++) {
      reader.readU8();
    }

    const admin =
      reader.readPublicKey();

    const decodedElectionId =
      reader.readU64();

    const name =
      reader.readString();

    const description =
      reader.readString();

    const startUnix =
      reader.readI64();

    const endUnix =
      reader.readI64();

    const bump =
      reader.readU8();

    const status =
      reader.readU8();

    return {
      address: electionAddress,

      data: {
        admin,
        electionId:
          decodedElectionId,
        name,
        description,
        startUnix,
        endUnix,
        bump,
        status,
      },
    };
  } catch (error) {
    console.error(
      "fetchElection failed:",
      error
    );

    return null;
  }
}

/* =========================================================
   FETCH ALL PARTIES
========================================================= */

export async function fetchPartiesForElection(
  electionAddress: PublicKey
): Promise<PartyData[]> {
  const accounts =
    await connection.getProgramAccounts(
      PROGRAM_ID,
      {
        filters: [
          {
            memcmp: {
              offset: 8,
              bytes: electionAddress.toBase58(),
            },
          },
        ],
      }
    );

  const parties: PartyData[] = [];

  for (const account of accounts) {
    try {
      const data = account.account.data;

      /*
       * Anchor account:
       *
       * discriminator = 8 bytes
       *
       * Party:
       *   election = Pubkey = 32 bytes
       *   party_id = u64 = 8 bytes
       *   name     = String
       *   logo_url = String
       *   bump     = u8
       *
       * Minimum before strings:
       *
       * 8 + 32 + 8 + 4 + 4 + 1
       */

      if (data.length < 57) {
        continue;
      }

      let offset = 8;

      // --------------------------------------------------
      // election
      // --------------------------------------------------

      const election =
        new PublicKey(
          data.subarray(
            offset,
            offset + 32
          )
        );

      offset += 32;

      if (
        !election.equals(
          electionAddress
        )
      ) {
        continue;
      }

      // --------------------------------------------------
      // party_id
      // --------------------------------------------------

      if (
        offset + 8 >
        data.length
      ) {
        continue;
      }

      const partyId =
        data.readBigUInt64LE(
          offset
        );

      offset += 8;

      // --------------------------------------------------
      // name
      // --------------------------------------------------

      if (
        offset + 4 >
        data.length
      ) {
        continue;
      }

      const nameLength =
        data.readUInt32LE(
          offset
        );

      offset += 4;

      /*
       * Prevent corrupted / unrelated accounts
       * from making us allocate huge ranges.
       */

      if (
        nameLength >
        data.length - offset
      ) {
        console.warn(
          "Skipping invalid party account:",
          account.pubkey.toBase58(),
          {
            nameLength,
            offset,
            dataLength: data.length,
          }
        );

        continue;
      }

      const nameBytes =
        data.subarray(
          offset,
          offset + nameLength
        );

      const name =
        new TextDecoder().decode(
          nameBytes
        );

      offset += nameLength;

      // --------------------------------------------------
      // logo_url
      // --------------------------------------------------

      if (
        offset + 4 >
        data.length
      ) {
        continue;
      }

      const logoLength =
        data.readUInt32LE(
          offset
        );

      offset += 4;

      if (
        logoLength >
        data.length - offset
      ) {
        console.warn(
          "Skipping invalid party logo:",
          account.pubkey.toBase58()
        );

        continue;
      }

      const logoBytes =
        data.subarray(
          offset,
          offset + logoLength
        );

      const logoUrl =
        new TextDecoder().decode(
          logoBytes
        );

      offset += logoLength;

      // --------------------------------------------------
      // bump
      // --------------------------------------------------

      if (
        offset + 1 >
        data.length
      ) {
        continue;
      }

      const bump =
        data.readUInt8(
          offset
        );

      // --------------------------------------------------
      // final validation
      // --------------------------------------------------

      parties.push({
        address: account.pubkey,
        election,
        partyId,
        name,
        logoUrl,
        bump,
      });
    } catch (error) {
      console.error(
        "Failed to decode party:",
        account.pubkey.toBase58(),
        error
      );
    }
  }

  parties.sort(
    (a, b) =>
      a.partyId < b.partyId
        ? -1
        : a.partyId > b.partyId
          ? 1
          : 0
  );

  return parties;
}

/* =========================================================
   CHECK VOTER REGISTERED
========================================================= */

export async function isVoterRegistered(
  walletAddress:
    | PublicKey
    | string,
  electionId:
    | number
    | bigint = ELECTION_ID
): Promise<boolean> {
  try {
    const wallet =
      typeof walletAddress ===
      "string"
        ? new PublicKey(
            walletAddress
          )
        : walletAddress;

    /*
     * getVoterPda() returns:
     *
     * [PublicKey, bump]
     */

    const [voterAddress] =
      getVoterPda(
        electionId,
        wallet
      );

    const accountInfo =
      await connection.getAccountInfo(
        voterAddress
      );

    return accountInfo !== null;
  } catch (error) {
    console.error(
      "isVoterRegistered failed:",
      error
    );

    return false;
  }
}

/* =========================================================
   FETCH VOTER STATUS
========================================================= */

export async function fetchVoterStatus(
  walletAddress:
    | PublicKey
    | string,
  electionId:
    | number
    | bigint = ELECTION_ID
): Promise<VoterStatus | null> {
  try {
    const wallet =
      typeof walletAddress ===
      "string"
        ? new PublicKey(
            walletAddress
          )
        : walletAddress;

    /*
     * getVoterPda() returns:
     *
     * [PublicKey, bump]
     */

    const [voterAddress] =
      getVoterPda(
        electionId,
        wallet
      );

    const accountInfo =
      await connection.getAccountInfo(
        voterAddress
      );

    if (!accountInfo) {
      return null;
    }

    /*
     * Voter account layout:
     *
     * discriminator   8
     * election       32
     * wallet         32
     * registered_at   8
     * voted           1
     * bump            1
     */

    const reader =
      new ByteReader(
        accountInfo.data
      );

    // Skip discriminator
    for (let i = 0; i < 8; i++) {
      reader.readU8();
    }

    const election =
      reader.readPublicKey();

    const registeredWallet =
      reader.readPublicKey();

    // registered_at
    reader.readI64();

    const voted =
      reader.readU8() !== 0;

    // bump
    reader.readU8();

    /*
     * Check election PDA.
     */

    const [expectedElection] =
      getElectionPda(
        electionId
      );

    if (
      !election.equals(
        expectedElection
      )
    ) {
      return null;
    }

    /*
     * Check wallet.
     */

    if (
      !registeredWallet.equals(
        wallet
      )
    ) {
      return null;
    }

    return {
      verified: true,
      hasVoted: voted,
      address: voterAddress,
    };
  } catch (error) {
    console.error(
      "fetchVoterStatus failed:",
      error
    );

    return null;
  }
}

/* =========================================================
   FETCH SINGLE PARTY
========================================================= */

export async function fetchParty(
  electionId:
    | number
    | bigint,
  partyId:
    | number
    | bigint
): Promise<PartyData | null> {
  try {
    /*
     * getPartyPda() returns:
     *
     * [PublicKey, bump]
     */

    const [partyAddress] =
      getPartyPda(
        electionId,
        partyId
      );

    const accountInfo =
      await connection.getAccountInfo(
        partyAddress
      );

    if (!accountInfo) {
      return null;
    }

    const reader =
      new ByteReader(
        accountInfo.data
      );

    // Skip discriminator
    for (let i = 0; i < 8; i++) {
      reader.readU8();
    }

    const election =
      reader.readPublicKey();

    const decodedPartyId =
      reader.readU64();

    const name =
      reader.readString();

    const logoUrl =
      reader.readString();

    const bump =
      reader.readU8();

    const [expectedElection] =
      getElectionPda(
        electionId
      );

    if (
      !election.equals(
        expectedElection
      )
    ) {
      return null;
    }

    if (
      decodedPartyId !==
      BigInt(partyId)
    ) {
      return null;
    }

    return {
      address: partyAddress,
      election,
      partyId:
        decodedPartyId,
      name,
      logoUrl,
      bump,
    };
  } catch (error) {
    console.error(
      "fetchParty failed:",
      error
    );

    return null;
  }
}

/* =========================================================
   ELECTION STATUS
========================================================= */

export type ElectionStatus =
  | {
      state: "not-started";
      canVerify: false;
      startUnix: bigint;
      endUnix: bigint;
      name: string;
    }
  | {
      state: "active";
      canVerify: true;
      startUnix: bigint;
      endUnix: bigint;
      name: string;
    }
  | {
      state: "ended";
      canVerify: false;
      startUnix: bigint;
      endUnix: bigint;
      name: string;
    };

export async function getElectionStatus(
  electionId:
    | number
    | bigint = ELECTION_ID
): Promise<ElectionStatus | null> {
  const result =
    await fetchElection(
      electionId
    );

  if (!result) {
    return null;
  }

  const now =
    BigInt(
      Math.floor(
        Date.now() / 1000
      )
    );

  const {
    startUnix,
    endUnix,
    name,
  } = result.data;

  if (now < startUnix) {
    return {
      state: "not-started",
      canVerify: false,
      startUnix,
      endUnix,
      name,
    };
  }

  if (now >= endUnix) {
    return {
      state: "ended",
      canVerify: false,
      startUnix,
      endUnix,
      name,
    };
  }

  return {
    state: "active",
    canVerify: true,
    startUnix,
    endUnix,
    name,
  };
}

/* =========================================================
   GET SOLANA CONNECTION
========================================================= */

export function getSolanaConnection(): Connection {
  return connection;
}