"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

import Link from "next/link";

import {
  InitCryptoForm,
  RevealResultsForm,
} from "@/components/AdminCrypto";
import {
  PhantomAnchorWallet,
  PhantomWalletProvider,
  getElectionPda,
  getPartyPda,
  getProgram,
  getVoterPda,
} from "@/lib/anchor";


const ADMIN_WALLET =
  "Fo2UJytmzSxKCV9gnu1YE2aWsZqDBN6XaKDdhwckiTYV";


/* ============================================================
   WINDOW TYPES
============================================================ */

declare global {
  interface Window {
    phantom?: {
      solana?: PhantomWalletProvider;
    };

    solana?: PhantomWalletProvider;
  }
}


/* ============================================================
   MAIN DASHBOARD
============================================================ */

export default function AdminDashboard() {

  const [activeTab, setActiveTab] =
    useState<
      "election" | "party" | "voter" | "crypto" | "reveal"
    >("election");


  return (
    <main className="admin-page">

      <div className="admin-background-decoration admin-decoration-one" />

      <div className="admin-background-decoration admin-decoration-two" />


      <div className="admin-container">


        {/* ==================================================
            HEADER
        ================================================== */}

        <header className="admin-header">

          <div className="admin-brand">

            <div className="admin-brand-logo">

              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >

                <path
                  d="M12 3L19 6V11.5C19 16.2 16 19.5 12 21C8 19.5 5 16.2 5 11.5V6L12 3Z"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                <path
                  d="M8.5 12L10.8 14.3L15.5 9.6"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

              </svg>

            </div>

            <span>
              BlockVote
            </span>

          </div>


          <Link
            href="/scoreboard"
            className="admin-wallet"
            style={{ textDecoration: "none", marginLeft: "auto", marginRight: 10 }}
          >
            ผลคะแนน
          </Link>

          <div className="admin-wallet">

            <span className="admin-wallet-dot" />

            <span>
              Admin
            </span>

          </div>

        </header>


        {/* ==================================================
            TITLE
        ================================================== */}

        <section className="admin-title-section">

          <div>

            <p className="admin-eyebrow">
              ADMINISTRATOR
            </p>

            <h1>
              Election Management
            </h1>

            <p>
              Manage elections, parties and voter
              registration on the Solana blockchain.
            </p>

          </div>

        </section>


        {/* ==================================================
            TABS
        ================================================== */}

        <nav className="admin-tabs">

          <button
            className={
              activeTab === "election"
                ? "admin-tab active"
                : "admin-tab"
            }
            onClick={() =>
              setActiveTab("election")
            }
          >
            <span>01</span>
            Create Election
          </button>


          <button
            className={
              activeTab === "party"
                ? "admin-tab active"
                : "admin-tab"
            }
            onClick={() =>
              setActiveTab("party")
            }
          >
            <span>02</span>
            Create Party
          </button>


          <button
            className={
              activeTab === "voter"
                ? "admin-tab active"
                : "admin-tab"
            }
            onClick={() =>
              setActiveTab("voter")
            }
          >
            <span>03</span>
            Register Voter
          </button>

          <button
            className={
              activeTab === "crypto"
                ? "admin-tab active"
                : "admin-tab"
            }
            onClick={() =>
              setActiveTab("crypto")
            }
          >
            <span>04</span>
            Encryption Key
          </button>


          <button
            className={
              activeTab === "reveal"
                ? "admin-tab active"
                : "admin-tab"
            }
            onClick={() =>
              setActiveTab("reveal")
            }
          >
            <span>05</span>
            Reveal Results
          </button>

        </nav>


        {/* ==================================================
            CONTENT
        ================================================== */}

        {(activeTab === "election" ||
          activeTab === "party" ||
          activeTab === "voter") && (
          <section className="admin-card">

            {activeTab === "election" && (
              <CreateElectionForm />
            )}

            {activeTab === "party" && (
              <CreatePartyForm />
            )}

            {activeTab === "voter" && (
              <RegisterVoterForm />
            )}

          </section>
        )}

        {/* ฟอร์มกลุ่มนี้มี admin-card ในตัวเองอยู่แล้ว */}

        {activeTab === "crypto" && (
          <InitCryptoForm />
        )}

        {activeTab === "reveal" && (
          <>
            <RevealResultsForm />

            <p style={{ marginTop: 16 }}>
              <Link href="/scoreboard">
                ดู Scoreboard →
              </Link>
            </p>
          </>
        )}

      </div>

    </main>
  );
}


/* ============================================================
   CREATE ELECTION
============================================================ */

function CreateElectionForm() {

  const [electionId, setElectionId] =
    useState("");

  const [name, setName] =
    useState("");

  const [description, setDescription] =
    useState("");

  const [startDate, setStartDate] =
    useState("");

  const [endDate, setEndDate] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [success, setSuccess] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);


  /* ==========================================================
     CREATE ELECTION
  ========================================================== */

  const handleCreateElection = async () => {

    setSuccess(null);
    setError(null);


    /* --------------------------------------------------------
       BASIC VALIDATION
    -------------------------------------------------------- */

    if (electionId.trim() === "") {
      setError(
        "Election ID is required."
      );
      return;
    }


    if (!/^\d+$/.test(electionId)) {
      setError(
        "Election ID must be a non-negative integer."
      );
      return;
    }


    const parsedElectionId =
      Number(electionId);


    if (
      !Number.isSafeInteger(
        parsedElectionId
      )
    ) {
      setError(
        "Election ID is too large."
      );
      return;
    }


    if (name.trim() === "") {
      setError(
        "Election name cannot be empty."
      );
      return;
    }


    if (
      new TextEncoder()
        .encode(name)
        .length > 100
    ) {
      setError(
        "Election name cannot exceed 100 bytes."
      );
      return;
    }


    if (
      new TextEncoder()
        .encode(description)
        .length > 1000
    ) {
      setError(
        "Election description cannot exceed 1000 bytes."
      );
      return;
    }


    if (!startDate) {
      setError(
        "Start date and time are required."
      );
      return;
    }


    if (!endDate) {
      setError(
        "End date and time are required."
      );
      return;
    }


    /* --------------------------------------------------------
       CONVERT DATETIME TO UNIX
    -------------------------------------------------------- */

    const startMilliseconds =
      new Date(startDate).getTime();

    const endMilliseconds =
      new Date(endDate).getTime();


    if (
      !Number.isFinite(
        startMilliseconds
      )
    ) {
      setError(
        "Invalid start date."
      );
      return;
    }


    if (
      !Number.isFinite(
        endMilliseconds
      )
    ) {
      setError(
        "Invalid end date."
      );
      return;
    }


    const startUnix =
      Math.floor(
        startMilliseconds / 1000
      );

    const endUnix =
      Math.floor(
        endMilliseconds / 1000
      );


    /* --------------------------------------------------------
       TIME RANGE
    -------------------------------------------------------- */

    if (
      startUnix >= endUnix
    ) {
      setError(
        "Start time must be before end time."
      );
      return;
    }


    /* --------------------------------------------------------
       END MUST BE FUTURE
    -------------------------------------------------------- */

    const currentUnix =
      Math.floor(
        Date.now() / 1000
      );


    if (
      endUnix <= currentUnix
    ) {
      setError(
        "End time must be in the future."
      );
      return;
    }


    /* --------------------------------------------------------
       PHANTOM
    -------------------------------------------------------- */

    if (
      typeof window === "undefined"
    ) {
      setError(
        "Browser environment not available."
      );
      return;
    }


    const provider =
      window.phantom?.solana ??
      window.solana;


    if (!provider) {
      setError(
        "Phantom wallet was not detected."
      );
      return;
    }


    if (!provider.publicKey) {

      try {

        await provider.connect();

      } catch {

        setError(
          "Please connect your Phantom wallet first."
        );

        return;
      }
    }


    if (!provider.publicKey) {
      setError(
        "Phantom wallet is not connected."
      );
      return;
    }


    /* --------------------------------------------------------
       VERIFY ADMIN
    -------------------------------------------------------- */

    const walletAddress =
      provider.publicKey.toString();


    if (
      walletAddress !== ADMIN_WALLET
    ) {
      setError(
        "This wallet is not authorized as the BlockVote administrator."
      );
      return;
    }


    /* --------------------------------------------------------
       CREATE ANCHOR WALLET
    -------------------------------------------------------- */

    const wallet =
      new PhantomAnchorWallet(
        provider
      );


    /* --------------------------------------------------------
       CREATE PROGRAM
    -------------------------------------------------------- */

    setLoading(true);


    try {

      const program =
        getProgram(wallet);


      /* ------------------------------------------------------
         ELECTION PDA
      ------------------------------------------------------ */

      const [
        electionPda,
        electionBump,
      ] =
        getElectionPda(
          parsedElectionId
        );


      console.log(
        "========================================"
      );

      console.log(
        "BlockVote - CREATE ELECTION"
      );

      console.log(
        "========================================"
      );

      console.log(
        "Program:",
        program.programId.toBase58()
      );

      console.log(
        "Admin:",
        wallet.publicKey.toBase58()
      );

      console.log(
        "Election ID:",
        parsedElectionId
      );

      console.log(
        "Election Name:",
        name
      );

      console.log(
        "Start Unix:",
        startUnix
      );

      console.log(
        "End Unix:",
        endUnix
      );

      console.log(
        "Election PDA:",
        electionPda.toBase58()
      );

      console.log(
        "Election Bump:",
        electionBump
      );


      /* ------------------------------------------------------
         CHECK WHETHER ELECTION ALREADY EXISTS
      ------------------------------------------------------ */

      try {

        await program.account.election.fetch(
          electionPda
        );

        setError(
          `Election ${parsedElectionId} already exists.`
        );

        setLoading(false);

        return;

      } catch {
        /*
         * Account does not exist.
         * This is expected when creating a new election.
         */
      }


      /* ------------------------------------------------------
         CREATE ELECTION TRANSACTION
      ------------------------------------------------------ */

      const signature =
        await program.methods
          .createElection(
            new anchor.BN(
              parsedElectionId
            ),

            name,

            description,

            new anchor.BN(
              startUnix
            ),

            new anchor.BN(
              endUnix
            )
          )
          .accounts({
            admin:
              wallet.publicKey,
          })
          .rpc();


      /* ------------------------------------------------------
         SUCCESS
      ------------------------------------------------------ */

      console.log(
        "Election created."
      );

      console.log(
        "Transaction:",
        signature
      );


      setSuccess(
        `Election created successfully. Transaction: ${signature}`
      );


      /* ------------------------------------------------------
         RESET FORM
      ------------------------------------------------------ */

      setElectionId("");
      setName("");
      setDescription("");
      setStartDate("");
      setEndDate("");


    } catch (err: unknown) {

      console.error(
        "Create election failed:",
        err
      );


      let message =
        "Failed to create election.";


      if (
        err instanceof Error
      ) {
        message =
          err.message;
      }


      const anchorError =
        err as {
          error?: {
            errorMessage?: string;
          };
          logs?: string[];
        };


      if (
        anchorError.error?.errorMessage
      ) {
        message =
          anchorError.error.errorMessage;
      }


      setError(message);

    } finally {

      setLoading(false);

    }
  };


  return (
    <div>

      {/* ====================================================
          HEADER
      ==================================================== */}

      <div className="form-header">

        <div className="form-icon">
          +
        </div>

        <div>

          <h2>
            Create Election
          </h2>

          <p>
            Create a new election on the blockchain.
          </p>

        </div>

      </div>


      {/* ====================================================
          FORM
      ==================================================== */}

      <div className="form-grid">

        <div className="form-group">

          <label>
            Election ID
          </label>

          <input
            type="number"
            min="0"
            value={electionId}
            onChange={(event) =>
              setElectionId(
                event.target.value
              )
            }
            placeholder="e.g. 1"
            disabled={loading}
          />

          <span className="input-hint">
            Must be a non-negative integer.
          </span>

        </div>


        <div className="form-group">

          <label>
            Election Name
          </label>

          <input
            type="text"
            maxLength={100}
            value={name}
            onChange={(event) =>
              setName(
                event.target.value
              )
            }
            placeholder="e.g. Student Council Election 2026"
            disabled={loading}
          />

          <span className="input-hint">
            Maximum 100 bytes.
          </span>

        </div>

      </div>


      {/* ====================================================
          DESCRIPTION
      ==================================================== */}

      <div className="form-group">

        <label>
          Description
        </label>

        <textarea
          maxLength={1000}
          rows={5}
          value={description}
          onChange={(event) =>
            setDescription(
              event.target.value
            )
          }
          placeholder="Describe this election..."
          disabled={loading}
        />

        <span className="input-hint">
          Maximum 1000 bytes.
        </span>

      </div>


      {/* ====================================================
          DATE
      ==================================================== */}

      <div className="form-grid">

        <div className="form-group">

          <label>
            Start Date & Time
          </label>

          <input
            type="datetime-local"
            value={startDate}
            onChange={(event) =>
              setStartDate(
                event.target.value
              )
            }
            disabled={loading}
          />

        </div>


        <div className="form-group">

          <label>
            End Date & Time
          </label>

          <input
            type="datetime-local"
            value={endDate}
            onChange={(event) =>
              setEndDate(
                event.target.value
              )
            }
            disabled={loading}
          />

        </div>

      </div>


      {/* ====================================================
          ERROR
      ==================================================== */}

      {error && (

        <div className="admin-message admin-error">

          <span className="admin-message-icon">
            !
          </span>

          <div>

            <strong>
              Transaction failed
            </strong>

            <p>
              {error}
            </p>

          </div>

        </div>

      )}


      {/* ====================================================
          SUCCESS
      ==================================================== */}

      {success && (

        <div className="admin-message admin-success">

          <span className="admin-message-icon">
            ✓
          </span>

          <div>

            <strong>
              Election created
            </strong>

            <p>
              {success}
            </p>

          </div>

        </div>

      )}


      {/* ====================================================
          ACTION
      ==================================================== */}

      <div className="form-actions">

        <button
          className="primary-admin-button"
          onClick={
            handleCreateElection
          }
          disabled={loading}
        >

          {loading ? (

            <>
              <span className="admin-button-spinner" />
              Creating Election...
            </>

          ) : (

            <>
              Create Election
            </>

          )}

        </button>

      </div>

    </div>
  );
}


/* ============================================================
   CREATE PARTY
============================================================ */

function CreatePartyForm() {
  const [electionId, setElectionId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleCreateParty = async () => {
    setError("");
    setSuccess("");

    // -----------------------------
    // Validate Election ID
    // -----------------------------
    if (!electionId.trim()) {
      setError("Please enter an Election ID.");
      return;
    }

    if (!/^\d+$/.test(electionId.trim())) {
      setError("Election ID must contain numbers only.");
      return;
    }

    let parsedElectionId: number;

    try {
      parsedElectionId = Number(electionId);

      if (!Number.isSafeInteger(parsedElectionId)) {
        setError("Election ID is too large.");
        return;
      }
    } catch {
      setError("Invalid Election ID.");
      return;
    }

    // -----------------------------
    // Validate Party Name
    // -----------------------------
    const name = partyName.trim();

    if (!name) {
      setError("Please enter a party name.");
      return;
    }

    const nameBytes = new TextEncoder().encode(name);

    if (nameBytes.length > 100) {
      setError("Party name must be 100 bytes or less.");
      return;
    }

    // -----------------------------
    // Validate Logo URL
    // -----------------------------
    const logo = logoUrl.trim();

    const logoBytes = new TextEncoder().encode(logo);

    if (logoBytes.length > 500) {
      setError("Logo URL must be 500 bytes or less.");
      return;
    }

    // -----------------------------
    // Get Phantom
    // -----------------------------
    if (typeof window === "undefined") {
      setError("Wallet is not available.");
      return;
    }

    const provider =
      window.phantom?.solana ??
      window.solana;

    if (!provider) {
      setError("Phantom Wallet was not detected.");
      return;
    }

    if (!provider.publicKey) {
      setError("Please connect the admin wallet first.");
      return;
    }

    // -----------------------------
    // Check Admin Wallet
    // -----------------------------
    const ADMIN_WALLET =
      "Fo2UJytmzSxKCV9gnu1YE2aWsZqDBN6XaKDdhwckiTYV";

    if (
      provider.publicKey.toString() !==
      ADMIN_WALLET
    ) {
      setError(
        "Only the admin wallet can create a party."
      );
      return;
    }

    setLoading(true);

    try {
      // -----------------------------
      // Create Anchor wallet
      // -----------------------------
      const wallet =
        new PhantomAnchorWallet(provider);

      const program =
        getProgram(wallet);

      // -----------------------------
      // Election PDA
      // -----------------------------
      const [electionPda] =
        getElectionPda(
          parsedElectionId
        );

      // -----------------------------
      // Check Election exists
      // -----------------------------
      try {
        await program.account.election.fetch(
          electionPda
        );
      } catch {
        throw new Error(
          `Election ${parsedElectionId} does not exist.`
        );
      }

      // -----------------------------
      // Find next Party ID
      // -----------------------------
      const parties =
        await program.account.party.all([
          {
            memcmp: {
              offset: 8,
              bytes: electionPda.toBase58(),
            },
          },
        ]);

      const partyId = parties.length;

      // -----------------------------
      // Party PDA
      // -----------------------------
      const [partyPda] =
        getPartyPda(
          parsedElectionId,
          partyId
        );

      // -----------------------------
      // Make transaction
      // -----------------------------
      const signature =
        await program.methods
          .createParty(
            new anchor.BN(
              parsedElectionId
            ),
            new anchor.BN(partyId),
            logo,
            name
          )
          .accounts({
            admin: wallet.publicKey,
            election: electionPda,
            party: partyPda,
            systemProgram:
              anchor.web3.SystemProgram
                .programId,
          })
          .rpc();

      setSuccess(
        `Party created successfully! Party ID: ${partyId} • Transaction: ${signature}`
      );

      // -----------------------------
      // Reset form
      // -----------------------------
      setPartyName("");
      setLogoUrl("");
    } catch (err: any) {
      console.error(
        "Create party error:",
        err
      );

      let message =
        "Failed to create party.";

      if (err?.message) {
        message = err.message;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-card">
      <div className="form-header">
        <div className="form-icon">
          🏛️
        </div>

        <div>
          <h2>Create Party</h2>

          <p>
            Add a party to an existing election.
          </p>
        </div>
      </div>

      <div className="form-grid">

        {/* Election ID */}
        <div className="form-group">
          <label htmlFor="party-election-id">
            Election ID
          </label>

          <input
            id="party-election-id"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 1"
            value={electionId}
            onChange={(e) =>
              setElectionId(
                e.target.value
              )
            }
            disabled={loading}
          />

          <span className="input-hint">
            Enter the ID of an existing election.
          </span>
        </div>

        {/* Party Name */}
        <div className="form-group">
          <label htmlFor="party-name">
            Party Name
          </label>

          <input
            id="party-name"
            type="text"
            placeholder="e.g. Future Party"
            value={partyName}
            onChange={(e) =>
              setPartyName(
                e.target.value
              )
            }
            disabled={loading}
          />

          <span className="input-hint">
            Maximum 100 bytes.
          </span>
        </div>

        {/* Logo URL */}
        <div className="form-group">
          <label htmlFor="party-logo">
            Logo URL
          </label>

          <input
            id="party-logo"
            type="url"
            placeholder="https://example.com/logo.png"
            value={logoUrl}
            onChange={(e) =>
              setLogoUrl(
                e.target.value
              )
            }
            disabled={loading}
          />

          <span className="input-hint">
            Maximum 500 bytes.
          </span>
        </div>

      </div>

      {/* Error */}
      {error && (
        <div className="admin-message admin-error">
          <div className="admin-message-icon">
            !
          </div>

          <div>
            <strong>
              Transaction failed
            </strong>

            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="admin-message admin-success">
          <div className="admin-message-icon">
            ✓
          </div>

          <div>
            <strong>
              Party created
            </strong>

            <p>
              {success}
            </p>
          </div>
        </div>
      )}

      {/* Button */}
      <div className="form-actions">
        <button
          type="button"
          className="primary-admin-button"
          onClick={handleCreateParty}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="admin-button-spinner" />
              Creating Party...
            </>
          ) : (
            <>
              Create Party
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   REGISTER VOTER
============================================================ */

function RegisterVoterForm() {
  const [electionId, setElectionId] = useState("");
  const [voterWallet, setVoterWallet] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleRegisterVoter = async () => {
    setError("");
    setSuccess("");

    // --------------------------------
    // Validate Election ID
    // --------------------------------
    if (!electionId.trim()) {
      setError("Please enter an Election ID.");
      return;
    }

    if (!/^\d+$/.test(electionId.trim())) {
      setError("Election ID must contain numbers only.");
      return;
    }

    const parsedElectionId = Number(
      electionId.trim()
    );

    if (!Number.isSafeInteger(parsedElectionId)) {
      setError("Election ID is too large.");
      return;
    }

    // --------------------------------
    // Validate Wallet Address
    // --------------------------------
    const walletAddress =
      voterWallet.trim();

    if (!walletAddress) {
      setError(
        "Please enter the voter's wallet address."
      );
      return;
    }

    let voterPublicKey: PublicKey;

    try {
      voterPublicKey =
        new PublicKey(walletAddress);
    } catch {
      setError(
        "Invalid Solana wallet address."
      );
      return;
    }

    // --------------------------------
    // Get Phantom
    // --------------------------------
    if (typeof window === "undefined") {
      setError("Wallet is not available.");
      return;
    }

    const provider =
      window.phantom?.solana ??
      window.solana;

    if (!provider) {
      setError(
        "Phantom Wallet was not detected."
      );
      return;
    }

    if (!provider.publicKey) {
      setError(
        "Please connect the admin wallet first."
      );
      return;
    }

    // --------------------------------
    // Check Admin Wallet
    // --------------------------------
    const ADMIN_WALLET =
      "Fo2UJytmzSxKCV9gnu1YE2aWsZqDBN6XaKDdhwckiTYV";

    if (
      provider.publicKey.toString() !==
      ADMIN_WALLET
    ) {
      setError(
        "Only the admin wallet can register voters."
      );
      return;
    }

    setLoading(true);

    try {
      // --------------------------------
      // Create Anchor wallet
      // --------------------------------
      const wallet =
        new PhantomAnchorWallet(provider);

      const program =
        getProgram(wallet);

      // --------------------------------
      // Election PDA
      // --------------------------------
      const [electionPda] =
        getElectionPda(
          parsedElectionId
        );

      // --------------------------------
      // Check Election exists
      // --------------------------------
      try {
        await program.account.election.fetch(
          electionPda
        );
      } catch {
        throw new Error(
          `Election ${parsedElectionId} does not exist.`
        );
      }

      // --------------------------------
      // Voter PDA
      // --------------------------------
      const voterPda =
        getVoterPda(
          parsedElectionId,
          voterPublicKey
        );


      // --------------------------------
      // Check if already registered
      // --------------------------------
      const existingVoter =
      await program.account.voter.fetchNullable(
          voterPda
      );

      if (existingVoter) {
      throw new Error(
          "This wallet is already registered for this election."
      );
    }

      try {
        await program.account.voter.fetch(
          voterPda
        );

        throw new Error(
          "This wallet is already registered for this election."
        );
      } catch (err: any) {
        const message =
          err?.message ?? "";

        if (
          message.includes(
            "already registered"
          )
        ) {
          throw err;
        }

        // Account does not exist.
        // This is the expected case.
      }

      // --------------------------------
      // Register voter on-chain
      // --------------------------------
      const signature =
        await program.methods
          .registerVoter(
            new anchor.BN(
              parsedElectionId
            ),
            voterPublicKey
          )
          .accounts({
            admin: wallet.publicKey,
            election: electionPda,
            voter: voterPda,
            systemProgram:
              anchor.web3.SystemProgram
                .programId,
          })
          .rpc();

      // --------------------------------
      // Success
      // --------------------------------
      setSuccess(
        `Voter registered successfully! Transaction: ${signature}`
      );

      setVoterWallet("");
    } catch (err: any) {
      console.error(
        "Register voter error:",
        err
      );

      let message =
        "Failed to register voter.";

      if (err?.message) {
        message = err.message;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-card">
      <div className="form-header">
        <div className="form-icon">
          👤
        </div>

        <div>
          <h2>Register Voter</h2>

          <p>
            Register a wallet to vote in an election.
          </p>
        </div>
      </div>

      <div className="form-grid">

        {/* Election ID */}
        <div className="form-group">
          <label htmlFor="voter-election-id">
            Election ID
          </label>

          <input
            id="voter-election-id"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 1"
            value={electionId}
            onChange={(e) =>
              setElectionId(
                e.target.value
              )
            }
            disabled={loading}
          />

          <span className="input-hint">
            Enter the ID of an existing election.
          </span>
        </div>

        {/* Voter Wallet */}
        <div className="form-group">
          <label htmlFor="voter-wallet">
            Voter Wallet Address
          </label>

          <input
            id="voter-wallet"
            type="text"
            placeholder="Enter Solana wallet address"
            value={voterWallet}
            onChange={(e) =>
              setVoterWallet(
                e.target.value
              )
            }
            disabled={loading}
          />

          <span className="input-hint">
            The voter must provide their Solana wallet address.
          </span>
        </div>

      </div>

      {/* Error */}
      {error && (
        <div className="admin-message admin-error">
          <div className="admin-message-icon">
            !
          </div>

          <div>
            <strong>
              Registration failed
            </strong>

            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="admin-message admin-success">
          <div className="admin-message-icon">
            ✓
          </div>

          <div>
            <strong>
              Voter registered
            </strong>

            <p>{success}</p>
          </div>
        </div>
      )}

      {/* Button */}
      <div className="form-actions">
        <button
          type="button"
          className="primary-admin-button"
          onClick={handleRegisterVoter}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="admin-button-spinner" />
              Registering Voter...
            </>
          ) : (
            <>
              Register Voter
            </>
          )}
        </button>
      </div>
    </div>
  );
}