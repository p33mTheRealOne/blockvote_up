"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import Stepper from "@/components/Stepper";
import Shell from "@/components/Shell";
import {
  IconArrowRight,
  IconDownload,
  IconExternal,
} from "@/components/icons";
import { Loader2 } from "lucide-react";
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
   UI HELPERS
========================================================= */

function formatDate(unix: bigint | number) {
  return new Date(Number(unix) * 1000).toLocaleString(
    "th-TH",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  );
}

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
      <span className="hm-logo" aria-hidden="true">
        {name
          .trim()
          .charAt(0)
          .toUpperCase() || "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={`${name} logo`}
      width={40}
      height={40}
      className="hm-logo"
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
     UI-ONLY STATE / HELPERS
  ======================================================= */

  const [walletCopied, setWalletCopied] =
    useState(false);

  async function copyWallet() {
    if (!walletAddress) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        walletAddress
      );

      setWalletCopied(true);

      setTimeout(() => {
        setWalletCopied(false);
      }, 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  function downloadNonce() {
    if (!voteResult) {
      return;
    }

    const text = [
      "BlockVote - nonce backup",
      `Election: ${ELECTION_ID}`,
      `Wallet: ${walletAddress ?? ""}`,
      `Nonce: ${voteResult.nonceHex}`,
      `Tx: ${voteResult.tx}`,
    ].join("\n");

    const blob = new Blob([text], {
      type: "text/plain",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `blockvote-nonce-election-${ELECTION_ID}.txt`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  /* =======================================================
     ACCESS LOADING
  ======================================================= */

  if (
    accessState !== "granted"
  ) {
    return (
      <>
        <SiteNav />

        <Shell>
          <main className="hm-main">
            <p className="hm-wait" role="status">
              <Loader2
                className="animate-spin"
                size={18}
              />
              กำลังตรวจสอบสิทธิ์…
            </p>
          </main>
        </Shell>
      </>
    );
  }

  const done = !!voteResult || hasVoted;
  const stepCurrent = done ? 3 : 2;

  /* =======================================================
     MAIN UI
  ======================================================= */

  return (
    <>
      <SiteNav wallet={walletAddress} />

      <Shell>
        <Stepper current={stepCurrent} />

        <main className="hm-main">

          {/* ---------- Head ---------- */}

          <section>
            <h1 className="hm-h1">
              {election
                ? election.name
                : "บัตรเลือกตั้ง"}
            </h1>

            {election && (
              <p className="hm-lead">
                {election.description}
              </p>
            )}
          </section>

          {/* ---------- Ledger ---------- */}

          <dl className="hm-ledger">

            <div>
              <dt>สถานะ</dt>

              <dd
                className={
                  hasVoted || voteResult
                    ? "is-ok"
                    : "is-wait"
                }
              >
                {hasVoted || voteResult
                  ? "โหวตแล้ว"
                  : "ยังไม่ได้โหวต"}
              </dd>
            </div>

            <div>
              <dt>พรรค</dt>

              <dd>
                {loading
                  ? "—"
                  : parties.length}
              </dd>
            </div>

            <div>
              <dt>สิ้นสุด</dt>

              <dd>
                {election
                  ? formatDate(
                      election.endUnix
                    )
                  : "—"}
              </dd>
            </div>

            <div>
              <dt>กระเป๋า</dt>

              <dd>
                {walletAddress
                  ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
                  : "—"}
              </dd>

              <button
                type="button"
                onClick={copyWallet}
                className="hm-link"
              >
                {walletCopied
                  ? "คัดลอกแล้ว"
                  : "คัดลอก"}
              </button>
            </div>

          </dl>

          {/* ---------- How it works ---------- */}

          <details className="hm-disclosure">
            <summary>
              คะแนนถูกนับอย่างไร
            </summary>

            <ol>
              <li>
                คะแนนถูกเข้ารหัสแล้วบันทึกบนเชน
                Solana ไม่มีใครเห็นว่าคุณเลือกพรรคไหน
              </li>

              <li>
                โหวตได้ครั้งเดียว
                และแก้ไขไม่ได้หลังยืนยัน
              </li>

              <li>
                ผลคะแนนขึ้นที่หน้าผลคะแนน
                หลังการเลือกตั้งสิ้นสุดและผู้ดูแลเปิดเผยผล
              </li>
            </ol>
          </details>

          {/* ---------- Already voted ---------- */}

          {!loading &&
            !error &&
            hasVoted &&
            !voteResult && (
              <div className="hm-note" role="status">
                <p>
                  <strong>
                    คุณโหวตในการเลือกตั้งนี้แล้ว
                  </strong>
                </p>

                <p>โหวตซ้ำไม่ได้ ดูผลคะแนนได้ที่หน้าผลคะแนน</p>

                <Link
                  href="/scoreboard"
                  className="hm-link"
                >
                  ไปหน้าผลคะแนน
                  <IconArrowRight size={16} />
                </Link>
              </div>
            )}

          {/* ---------- Loading ---------- */}

          {loading && (
            <p className="hm-wait" role="status">
              <Loader2
                className="animate-spin"
                size={18}
              />
              กำลังโหลดรายชื่อพรรค…
            </p>
          )}

          {/* ---------- Load error ---------- */}

          {!loading && error && (
            <div
              className="hm-note hm-note--error"
              role="alert"
            >
              <p>
                <strong>โหลดข้อมูลไม่สำเร็จ</strong>
              </p>

              <p>{error}</p>
            </div>
          )}

          {/* ---------- No parties ---------- */}

          {!loading &&
            !error &&
            parties.length === 0 && (
              <div className="hm-note">
                <p>
                  <strong>
                    ยังไม่มีพรรคในการเลือกตั้งนี้
                  </strong>
                </p>

                <p>
                  เมื่อผู้ดูแลเพิ่มพรรคแล้ว
                  รายชื่อจะขึ้นที่นี่
                </p>
              </div>
            )}

          {/* ---------- Ballot ---------- */}

          {!loading &&
            !error &&
            parties.length > 0 &&
            !voteResult && (
              <section>

                <div className="hm-head">
                  <h2 className="hm-h2">
                    {hasVoted
                      ? "รายชื่อพรรค"
                      : "เลือกพรรค"}
                  </h2>

                  <span className="hm-label">
                    {parties.length} พรรค
                  </span>
                </div>

                <ol
                  className={
                    hasVoted
                      ? "hm-ballot"
                      : "hm-ballot is-open"
                  }
                  style={{ borderTop: 0 }}
                >
                  {parties.map((party) => (
                    <li key={party.address.toBase58()}>

                      <span className="hm-num">
                        {party.partyId.toString()}
                      </span>

                      <PartyLogo
                        name={party.name}
                        logoUrl={party.logoUrl}
                      />

                      <span className="hm-name">
                        {party.name}

                        <span className="hm-sub">
                          เบอร์{" "}
                          {party.partyId.toString()}
                        </span>
                      </span>

                      {hasVoted ? (
                        <span className="hm-done">
                          ปิดแล้ว
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            openConfirm(party)
                          }
                          className="hm-btn hm-btn--sm"
                          aria-label={`โหวต ${party.name}`}
                        >
                          โหวต
                        </button>
                      )}

                    </li>
                  ))}
                </ol>

              </section>
            )}

          {/* ---------- Vote success (the plate) ---------- */}

          {voteResult && (
            <>
              <section className="hm-plate" role="status">
                <h2 className="hm-h1">
                  โหวตสำเร็จ
                </h2>

                <p className="hm-lead">
                  เก็บ nonce ด้านล่างไว้ให้ดี
                  ต้องใช้ตอนเปิดเผยผลโหวต
                  ถ้าทำหายจะพิสูจน์คะแนนของคุณไม่ได้
                </p>
              </section>

              <section
                style={{
                  display: "grid",
                  gap: "var(--space-md)",
                }}
              >
                <div className="hm-head">
                  <h2 className="hm-h2">Nonce</h2>
                </div>

                <code className="hm-code">
                  {voteResult.nonceHex}
                </code>

                <div className="hm-actions">
                  <button
                    type="button"
                    onClick={copyNonce}
                    className="hm-btn hm-btn--sm"
                  >
                    {nonceCopied
                      ? "คัดลอกแล้ว"
                      : "คัดลอก"}
                  </button>

                  <button
                    type="button"
                    onClick={downloadNonce}
                    className="hm-btn hm-btn--sm"
                  >
                    <IconDownload size={16} />
                    ดาวน์โหลด
                  </button>
                </div>

                <p className="hm-label" style={{ margin: 0 }}>
                  ธุรกรรม
                </p>

                <code className="hm-code">
                  {voteResult.tx}
                </code>

                <a
                  href={`https://explorer.solana.com/tx/${voteResult.tx}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="hm-link"
                >
                  ดูบน Solana Explorer
                  <IconExternal size={16} />
                </a>

                <p
                  style={{
                    margin: 0,
                    fontSize: "var(--text-sm)",
                    color: "var(--color-muted)",
                  }}
                >
                  ระบบเก็บสำเนา nonce ไว้ในเบราว์เซอร์นี้ด้วย
                  แต่ข้อมูลหายได้ถ้าล้างเบราว์เซอร์
                  จึงควรดาวน์โหลดเก็บไว้
                </p>

                <Link
                  href="/scoreboard"
                  className="hm-btn hm-btn--solid hm-btn--block"
                >
                  ไปดูผลคะแนน
                  <IconArrowRight size={16} />
                </Link>
              </section>
            </>
          )}

          {/* ---------- Secondary route ---------- */}

          {!voteResult && !loading && (
            <div className="hm-actions">
              <Link
                href="/scoreboard"
                className="hm-link"
              >
                ดูผลคะแนน
                <IconArrowRight size={16} />
              </Link>
            </div>
          )}

        </main>
      </Shell>

      {/* ===================================================
          CONFIRM SHEET
      =================================================== */}

      {selectedParty && (
        <div
          className="hm-scrim"
          onClick={closeConfirm}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ยืนยันการลงคะแนน"
            className="hm-sheet"
            onClick={(e) => e.stopPropagation()}
          >

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-md)",
              }}
            >
              <PartyLogo
                name={selectedParty.name}
                logoUrl={selectedParty.logoUrl}
              />

              <div style={{ minWidth: 0 }}>
                <h2 className="hm-h2">
                  {selectedParty.name}
                </h2>

                <span className="hm-sub">
                  เบอร์{" "}
                  {selectedParty.partyId.toString()}
                </span>
              </div>
            </div>

            <p style={{ margin: 0 }}>
              ยืนยันโหวตพรรคนี้ใช่หรือไม่
              เมื่อยืนยันแล้วแก้ไขไม่ได้
            </p>

            {voteError && (
              <div
                className="hm-note hm-note--error"
                role="alert"
              >
                <p>
                  <strong>โหวตไม่สำเร็จ</strong>
                </p>

                <p>{voteError}</p>
              </div>
            )}

            <div className="hm-actions">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={voting}
                className="hm-btn"
              >
                ยกเลิก
              </button>

              <button
                type="button"
                onClick={confirmVote}
                disabled={voting || hasVoted}
                aria-busy={voting}
                className="hm-btn hm-btn--solid"
              >
                {voting ? (
                  <>
                    <Loader2
                      className="animate-spin"
                      size={16}
                    />
                    กำลังบันทึก…
                  </>
                ) : (
                  "ยืนยันโหวต"
                )}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
