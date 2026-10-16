"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Vote,
  AlertCircle,
  Loader2,
  Users,
  Check,
  X,
  Copy,
} from "lucide-react";
import { PublicKey } from "@solana/web3.js";

import {
  fetchElection,
  fetchPartiesForElection,
  fetchVoterStatus,
  type ElectionData,
  type PartyData,
} from "@/lib/solana-program";

import {
  submitVoteCommit,
  type VoteCommitResult,
} from "@/lib/vote_commit";

/* =========================================================
   CONFIG
========================================================= */

const ELECTION_ID = 7;

/* =========================================================
   TYPES
========================================================= */

type AccessState =
  | "checking"
  | "denied"
  | "granted";

/* =========================================================
   PARTY LOGO
========================================================= */

function PartyLogo({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string;
}) {
  const [failed, setFailed] =
    useState(!logoUrl);

  if (failed) {
    return (
      <div className="h-14 w-14 shrink-0 rounded-2xl bg-blue-100 flex items-center justify-center">
        <span className="text-blue-600 font-bold text-lg">
          {name
            .trim()
            .charAt(0)
            .toUpperCase() || "?"}
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={`${name} logo`}
      className="h-14 w-14 shrink-0 rounded-2xl object-cover bg-slate-100"
      onError={() => setFailed(true)}
    />
  );
}

/* =========================================================
   VOTE PAGE
========================================================= */

export default function VotePage() {
  const router = useRouter();

  /* =======================================================
     ACCESS CONTROL
  ======================================================= */

  const [accessState, setAccessState] =
    useState<AccessState>("checking");

  const [walletAddress, setWalletAddress] =
    useState<string | null>(null);

  const [hasVoted, setHasVoted] =
    useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      /*
       * Check Phantom.
       */

      if (
        typeof window === "undefined" ||
        !("solana" in window)
      ) {
        if (!cancelled) {
          router.replace("/");
        }

        return;
      }

      const provider = (
        window as {
          solana?: any;
        }
      ).solana;

      if (!provider?.isPhantom) {
        if (!cancelled) {
          router.replace("/");
        }

        return;
      }

      /*
       * Try to reconnect silently.
       *
       * onlyIfTrusted means:
       * - If this wallet has already connected to this site,
       *   Phantom can reconnect without showing the popup.
       * - If it has never connected, access is denied.
       */

      let address: string;

      try {
        const response =
          await provider.connect({
            onlyIfTrusted: true,
          });

        address =
          response.publicKey.toString();
      } catch {
        if (!cancelled) {
          router.replace("/");
        }

        return;
      }

      /*
       * Check the Voter PDA on Solana.
       *
       * This is NOT based on localStorage.
       *
       * If the wallet has a valid Voter account for
       * Election ID 6, the user can enter /vote.
       */

      try {
        const status =
          await fetchVoterStatus(
            address,
            ELECTION_ID
          );

        if (cancelled) {
          return;
        }

        if (
          !status ||
          !status.verified
        ) {
          router.replace("/verify");
          return;
        }

        setWalletAddress(address);
        setHasVoted(
          status.hasVoted
        );
        setAccessState("granted");
      } catch (error) {
        console.error(
          "Failed to check voter status:",
          error
        );

        if (!cancelled) {
          router.replace("/");
        }
      }
    }

    checkAccess();

    return () => {
      cancelled = true;
    };

    // We intentionally run this once on page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =======================================================
     ELECTION / PARTY DATA
  ======================================================= */

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [election, setElection] =
    useState<ElectionData | null>(null);

  const [electionAddress, setElectionAddress] =
    useState<PublicKey | null>(null);

  const [parties, setParties] =
    useState<PartyData[]>([]);

  useEffect(() => {
    if (
      accessState !== "granted"
    ) {
      return;
    }

    let cancelled = false;

    async function loadElection() {
      setLoading(true);
      setError(null);

      /*
       * Fetch Election ID 6 from Solana.
       */

      const result =
        await fetchElection(
          ELECTION_ID
        );

      if (cancelled) {
        return;
      }

      if (!result) {
        setError(
          `ไม่พบข้อมูลการเลือกตั้งนี้ในเชน (election id = ${ELECTION_ID})`
        );

        setLoading(false);
        return;
      }

      /*
       * Save election information.
       */

      setElection(
        result.data
      );

      setElectionAddress(
        result.address
      );

      /*
       * Fetch ALL parties belonging to this election.
       *
       * fetchPartiesForElection() uses:
       *
       * memcmp offset 8
       *
       * exactly like tests/show_all_parties.ts
       */

      const partyList =
        await fetchPartiesForElection(
          result.address
        );

      if (cancelled) {
        return;
      }

      setParties(
        partyList
      );

      setLoading(false);
    }

    loadElection().catch(
      (error) => {
        console.error(
          "Failed to load election:",
          error
        );

        if (!cancelled) {
          setError(
            "เกิดข้อผิดพลาดในการโหลดข้อมูลจากเชน"
          );

          setLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [accessState]);

  /* =======================================================
     VOTE STATE
  ======================================================= */

  const [selectedParty, setSelectedParty] =
    useState<PartyData | null>(null);

  const [voting, setVoting] =
    useState(false);

  const [voteError, setVoteError] =
    useState<string | null>(null);

  const [voteResult, setVoteResult] =
    useState<VoteCommitResult | null>(
      null
    );

  const [nonceCopied, setNonceCopied] =
    useState(false);

  /* =======================================================
     OPEN CONFIRMATION
  ======================================================= */

  function openConfirm(
    party: PartyData
  ) {
    if (hasVoted) {
      return;
    }

    setVoteError(null);
    setSelectedParty(party);
  }

  /* =======================================================
     CLOSE CONFIRMATION
  ======================================================= */

  function closeConfirm() {
    if (voting) {
      return;
    }

    setSelectedParty(null);
    setVoteError(null);
  }

  /* =======================================================
     CONFIRM VOTE
  ======================================================= */

  async function confirmVote() {
    if (!selectedParty || !electionAddress) return;

    const provider = (window as { solana?: any }).solana;

    if (!provider?.publicKey) {
        setVoteError(
        "ไม่พบการเชื่อมต่อ wallet กรุณาลองใหม่"
        );
        return;
    }

    setVoting(true);
    setVoteError(null);

    try {
        const result = await submitVoteCommit({
        walletProvider: provider,
        election: electionAddress,
        partyId: Number(selectedParty.partyId),
        });

        setVoteResult(result);

        // สำเร็จจริงเท่านั้นจึง mark ว่าโหวตแล้ว
        setHasVoted(true);

        setSelectedParty(null);
    } catch (err) {
        console.error(
        "vote_commit failed",
        err
        );

        setVoteError(
        err instanceof Error
            ? err.message
            : "เกิดข้อผิดพลาดในการโหวต"
        );
    } finally {
        setVoting(false);
    }
    }

  /* =======================================================
     COPY NONCE
  ======================================================= */

  async function copyNonce() {
    if (!voteResult) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        voteResult.nonceHex
      );

      setNonceCopied(true);

      setTimeout(
        () => {
          setNonceCopied(false);
        },
        2000
      );
    } catch {
      /*
       * Clipboard unavailable.
       * User can still manually copy the nonce.
       */
    }
  }

  /* =======================================================
     ACCESS LOADING
  ======================================================= */

  if (
    accessState !== "granted"
  ) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2
            className="animate-spin text-blue-500"
            size={28}
          />

          <p className="text-sm text-slate-400">
            กำลังตรวจสอบสิทธิ์เข้าถึง…
          </p>
        </div>
      </main>
    );
  }

  /* =======================================================
     MAIN UI
  ======================================================= */

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto w-full max-w-lg">

        {/* =================================================
            HEADER ICON
        ================================================= */}

        <div className="flex justify-center mb-5 mt-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
            <Vote
              className="text-blue-600"
              size={30}
            />
          </div>
        </div>

        {/* =================================================
            ELECTION TITLE
        ================================================= */}

        <h1 className="text-2xl font-bold text-center text-slate-800">
          {election
            ? election.name
            : "การเลือกตั้ง"}
        </h1>

        {election && (
          <p className="text-center text-slate-500 mt-2 text-sm">
            {election.description}
          </p>
        )}

        {/* =================================================
            WALLET
        ================================================= */}

        {walletAddress && (
          <div className="mt-4 flex justify-center">
            <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
              <p className="text-[10px] text-slate-400 text-center">
                Wallet
              </p>

              <p className="text-xs text-slate-600 font-mono">
                {walletAddress.slice(
                  0,
                  6
                )}
                ...
                {walletAddress.slice(
                  -6
                )}
              </p>
            </div>
          </div>
        )}

        {/* =================================================
            LOADING PARTIES
        ================================================= */}

        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <Loader2
              className="animate-spin text-blue-500"
              size={28}
            />

            <p className="text-sm text-slate-500">
              กำลังโหลดรายชื่อพรรค…
            </p>
          </div>
        )}

        {/* =================================================
            LOAD ERROR
        ================================================= */}

        {!loading && error && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
            />

            <span>
              {error}
            </span>
          </div>
        )}

        {/* =================================================
            NO PARTIES
        ================================================= */}

        {!loading &&
          !error &&
          parties.length === 0 && (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
              <Users
                className="text-slate-300"
                size={32}
              />

              <p className="text-sm text-slate-500">
                ยังไม่มีพรรคการเมืองใน
                การเลือกตั้งนี้
              </p>
            </div>
          )}

        {/* =================================================
            PARTY LIST
        ================================================= */}

        {!loading &&
          !error &&
          parties.length > 0 &&
          !voteResult && (
            <div className="mt-6 space-y-3">

              {parties.map(
                (party) => (
                  <div
                    key={party.address.toBase58()}
                    className="flex items-center gap-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm"
                  >

                    {/* Party logo */}

                    <PartyLogo
                      name={
                        party.name
                      }
                      logoUrl={
                        party.logoUrl
                      }
                    />

                    {/* Party information */}

                    <div className="min-w-0 flex-1">

                      <p className="font-semibold text-slate-800 truncate">
                        {
                          party.name
                        }
                      </p>

                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        เบอร์{" "}
                        {
                          party.partyId.toString()
                        }
                      </p>

                    </div>

                    {/* Vote button */}

                    <button
                      onClick={() =>
                        openConfirm(
                          party
                        )
                      }
                      disabled={
                        hasVoted
                      }
                      className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                    >
                      {hasVoted
                        ? "โหวตแล้ว"
                        : "โหวต"}
                    </button>

                  </div>
                )
              )}

            </div>
          )}

        {/* =================================================
            VOTE SUCCESS
        ================================================= */}

        {voteResult && (
          <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-5">

            <div className="flex items-center gap-2 text-green-700 font-semibold">
              <Check size={18} />

              <span>
                โหวตสำเร็จ
              </span>
            </div>

            <p className="mt-3 text-sm text-slate-600">
              เก็บ{" "}
              <span className="font-semibold">
                nonce
              </span>{" "}
              นี้ไว้ให้ดี เพราะต้องใช้ตอน
              reveal ผลโหวตทีหลัง
              ถ้าทำหายจะพิสูจน์คะแนนโหวตของ
              คุณไม่ได้
            </p>

            {/* Nonce */}

            <div className="mt-3 flex items-center gap-2 rounded-xl bg-white border border-green-200 px-3 py-2">

              <code className="flex-1 break-all text-xs text-slate-700">
                {
                  voteResult.nonceHex
                }
              </code>

              <button
                onClick={
                  copyNonce
                }
                className="shrink-0 flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 transition-colors"
              >
                <Copy size={12} />

                {nonceCopied
                  ? "คัดลอกแล้ว"
                  : "คัดลอก"}
              </button>

            </div>

            {/* Transaction */}

            <p className="mt-3 text-xs text-slate-400 font-mono break-all">
              Tx:{" "}
              {voteResult.tx}
            </p>

            <p className="mt-2 text-xs text-slate-400">
              ระบบสำรอง nonce นี้ไว้ใน
              เบราว์เซอร์นี้ให้แล้วเช่นกัน
              แต่ไม่ควรพึ่งพาอย่างเดียว
              เพราะอาจหายได้ถ้าล้างข้อมูล
              เบราว์เซอร์
            </p>

          </div>
        )}

      </div>

      {/* ===================================================
          CONFIRMATION POPUP
      =================================================== */}

      {selectedParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">

          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">

            {/* Selected party */}

            <div className="flex items-center gap-3">

              <PartyLogo
                name={
                  selectedParty.name
                }
                logoUrl={
                  selectedParty.logoUrl
                }
              />

              <div className="min-w-0">

                <p className="font-semibold text-slate-800 truncate">
                  {
                    selectedParty.name
                  }
                </p>

                <p className="text-xs text-slate-400 font-mono">
                  เบอร์{" "}
                  {
                    selectedParty.partyId.toString()
                  }
                </p>

              </div>

            </div>

            {/* Confirmation text */}

            <p className="mt-4 text-sm text-slate-700">
              ต้องการโหวตพรรค{" "}
              <span className="font-semibold">
                {
                  selectedParty.name
                }
              </span>{" "}
              เบอร์{" "}
              {
                selectedParty.partyId.toString()
              }{" "}
              ใช่หรือไม่?
            </p>

            <p className="mt-2 text-xs text-slate-400">
              เมื่อยืนยันแล้วจะไม่สามารถ
              แก้ไขได้
            </p>

            {/* Vote error */}

            {voteError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">

                <AlertCircle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />

                <span>
                  {
                    voteError
                  }
                </span>

              </div>
            )}

            {/* Already voted */}

            {!loading &&
              !error &&
              hasVoted &&
              !voteResult && (
                <div className="mt-6 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">

                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />

                  <span>
                    คุณได้โหวตในการเลือกตั้งนี้
                    ไปแล้ว
                    ไม่สามารถโหวตซ้ำได้
                  </span>

                </div>
              )}

            {/* Buttons */}

            <div className="mt-5 flex gap-3">

              <button
                onClick={
                  closeConfirm
                }
                disabled={voting}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                <X size={16} />

                ไม่
              </button>

              <button
                onClick={
                  confirmVote
                }
                disabled={
                  voting ||
                  hasVoted
                }
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-70"
              >
                {voting ? (
                  <Loader2
                    className="animate-spin"
                    size={16}
                  />
                ) : (
                  <Check
                    size={16}
                  />
                )}

                ใช่
              </button>

            </div>

          </div>

        </div>
      )}
    </main>
  );
}