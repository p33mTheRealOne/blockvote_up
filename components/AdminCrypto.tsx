"use client";

import { useState } from "react";

import type { PhantomWalletProvider } from "@/lib/anchor";
import { ELECTION_ID } from "@/lib/election";
import {
  type DecryptPreview,
  decryptElectionVotes,
  initializeElectionCrypto,
  revealResultsOnChain,
} from "@/lib/reveal";

function getProvider(): PhantomWalletProvider | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.phantom?.solana ?? window.solana;
}

function Message({
  kind,
  title,
  children,
}: {
  kind: "error" | "success" | "warning";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`admin-message ${
        kind === "success" ? "admin-success" : "admin-error"
      }`}
    >
      <div className="admin-message-icon">
        {kind === "success" ? "✓" : "!"}
      </div>

      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

/* ============================================================
   INITIALIZE ELECTION CRYPTO
============================================================ */

export function InitCryptoForm() {
  const [electionId, setElectionId] = useState(String(ELECTION_ID));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleInit = async () => {
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const { signature, publicKeyBase64 } =
        await initializeElectionCrypto(getProvider(), electionId);

      setSuccess(
        `ตั้งค่ากุญแจสำเร็จ • Public key: ${publicKeyBase64} • Transaction: ${signature}`
      );
    } catch (err: any) {
      console.error("Init election crypto error:", err);
      setError(
        (err?.message ?? "Failed to initialize election crypto.") +
          " — หากไฟล์ key ถูกดาวน์โหลดไปแล้วแต่รายการไม่สำเร็จ ให้ลบไฟล์นั้นทิ้ง"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-card">
      <div className="form-header">
        <div className="form-icon">🔑</div>

        <div>
          <h2>Election Encryption Key</h2>

          <p>
            Generate the key pair used to encrypt ballots
            (initialize_election_crypto).
          </p>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="crypto-election-id">Election ID</label>

          <input
            id="crypto-election-id"
            type="text"
            inputMode="numeric"
            value={electionId}
            onChange={(e) => setElectionId(e.target.value)}
            disabled={loading}
          />

          <span className="input-hint">
            Public key จะถูกบันทึกบนเชน ส่วน private key จะถูกดาวน์โหลดเป็นไฟล์
            election-&lt;id&gt;.json เก็บไว้ให้ปลอดภัย — ต้องใช้ตอน Reveal
            และกู้คืนไม่ได้ถ้าหาย
          </span>
        </div>
      </div>

      {error && (
        <Message kind="error" title="Transaction failed">
          {error}
        </Message>
      )}

      {success && (
        <Message kind="success" title="Encryption key ready">
          {success}
        </Message>
      )}

      <div className="form-actions">
        <button
          type="button"
          className="primary-admin-button"
          onClick={handleInit}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="admin-button-spinner" />
              Initializing...
            </>
          ) : (
            "Generate Key & Initialize"
          )}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   REVEAL RESULTS
============================================================ */

export function RevealResultsForm() {
  const [electionId, setElectionId] = useState(String(ELECTION_ID));
  const [keyFileText, setKeyFileText] = useState("");
  const [keyFileName, setKeyFileName] = useState("");

  const [preview, setPreview] = useState<DecryptPreview | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const resetOutput = () => {
    setPreview(null);
    setError("");
    setSuccess("");
  };

  const handleKeyFile = async (file: File | undefined) => {
    resetOutput();

    if (!file) {
      setKeyFileText("");
      setKeyFileName("");
      return;
    }

    setKeyFileText(await file.text());
    setKeyFileName(file.name);
  };

  const handleDecrypt = async () => {
    resetOutput();

    if (!keyFileText) {
      setError("กรุณาเลือกไฟล์ private key ของ election");
      return;
    }

    setLoading(true);

    try {
      setPreview(await decryptElectionVotes(electionId, keyFileText));
    } catch (err: any) {
      console.error("Decrypt error:", err);
      setError(err?.message ?? "Failed to decrypt votes.");
    } finally {
      setLoading(false);
    }
  };

  const handleReveal = async () => {
    if (!preview) {
      return;
    }

    if (
      preview.invalidVotes > 0 &&
      !window.confirm(
        `มี ballot ที่ถอดรหัสไม่ได้/ไม่ถูกต้อง ${preview.invalidVotes} ใบ ซึ่งจะไม่ถูกนับ ต้องการ reveal ต่อหรือไม่?`
      )
    ) {
      return;
    }

    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const signature = await revealResultsOnChain(
        getProvider(),
        electionId,
        preview.tallies.map((t) => ({
          partyId: t.partyId,
          votes: t.votes,
        }))
      );

      setSuccess(
        `Reveal สำเร็จ ผลคะแนนถูกบันทึกบนเชนแล้ว • Transaction: ${signature}`
      );

      setPreview(null);
    } catch (err: any) {
      console.error("Reveal error:", err);
      setError(err?.message ?? "Failed to reveal results.");
    } finally {
      setLoading(false);
    }
  };

  const total = preview?.validVotes ?? 0;

  return (
    <div className="admin-card">
      <div className="form-header">
        <div className="form-icon">📊</div>

        <div>
          <h2>Reveal Results</h2>

          <p>
            Decrypt ballots after the election ends and publish the
            scoreboard on-chain (reveal_results). Admin wallet only.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="reveal-election-id">Election ID</label>

          <input
            id="reveal-election-id"
            type="text"
            inputMode="numeric"
            value={electionId}
            onChange={(e) => {
              setElectionId(e.target.value);
              resetOutput();
            }}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="reveal-key-file">Private key file</label>

          <input
            id="reveal-key-file"
            type="file"
            accept="application/json,.json"
            onChange={(e) => handleKeyFile(e.target.files?.[0])}
            disabled={loading}
          />

          <span className="input-hint">
            {keyFileName ||
              "ไฟล์ election-<id>.json ที่ได้ตอน Generate Key (ถอดรหัสในเบราว์เซอร์ ไฟล์ไม่ถูกอัปโหลดไปที่ไหน)"}
          </span>
        </div>
      </div>

      {preview && (
        <div className="admin-message admin-success">
          <div className="admin-message-icon">✓</div>

          <div style={{ width: "100%" }}>
            <strong>
              Decrypted {preview.validVotes} / {preview.encryptedVotes} ballots
            </strong>

            <table
              style={{
                width: "100%",
                marginTop: 12,
                borderCollapse: "collapse",
              }}
            >
              <tbody>
                {preview.tallies.map((t) => (
                  <tr key={t.partyId}>
                    <td style={{ padding: "4px 0" }}>
                      #{t.partyId} {t.name}
                    </td>

                    <td style={{ textAlign: "right" }}>
                      <strong>{t.votes}</strong>
                      {total > 0 &&
                        ` (${((t.votes / total) * 100).toFixed(1)}%)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {preview.invalidVotes > 0 && (
              <p>
                Invalid / undecryptable ballots: {preview.invalidVotes}
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <Message kind="error" title="Reveal failed">
          {error}
        </Message>
      )}

      {success && (
        <Message kind="success" title="Results revealed">
          {success}
        </Message>
      )}

      <div className="form-actions">
        <button
          type="button"
          className="primary-admin-button"
          onClick={handleDecrypt}
          disabled={loading || !keyFileText}
        >
          {loading && !preview ? (
            <>
              <span className="admin-button-spinner" />
              Working...
            </>
          ) : (
            "1. Decrypt & Preview"
          )}
        </button>

        {preview && (
          <button
            type="button"
            className="primary-admin-button"
            onClick={handleReveal}
            disabled={loading}
            style={{ marginLeft: 12 }}
          >
            {loading ? (
              <>
                <span className="admin-button-spinner" />
                Revealing...
              </>
            ) : (
              "2. Reveal on-chain"
            )}
          </button>
        )}
      </div>
    </div>
  );
}
