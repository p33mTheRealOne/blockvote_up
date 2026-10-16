"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ADMIN_WALLET =
  "Fo2UJytmzSxKCV9gnu1YE2aWsZqDBN6XaKDdhwckiTYV";

export default function ConnectWallet() {
  const router = useRouter();

  const [walletAddress, setWalletAddress] = useState("");
  const [connecting, setConnecting] = useState(false);

  function redirectByWallet(address: string) {
    if (address === ADMIN_WALLET) {
      router.push("/admin");
    } else {
      router.push("/verify");
    }
  }

  async function connectWallet() {
    try {
      setConnecting(true);

      const provider = (window as any).phantom?.solana;

      if (!provider) {
        alert("กรุณาติดตั้ง Phantom Wallet ก่อน");
        return;
      }

      const response = await provider.connect();

      const address = response.publicKey.toString();

      setWalletAddress(address);

      // Connect สำเร็จ → redirect ทันที
      redirectByWallet(address);
    } catch (error) {
      console.error("Wallet connection failed:", error);
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function reconnect() {
      try {
        const provider = (window as any).phantom?.solana;

        if (!provider) return;

        const response = await provider.connect({
          onlyIfTrusted: true,
        });

        if (cancelled) return;

        const address = response.publicKey.toString();

        setWalletAddress(address);

        // ถ้าเคย connect แล้ว → ไปหน้าที่ถูกต้อง
        redirectByWallet(address);
      } catch {
        // ไม่มี trusted connection
      }
    }

    reconnect();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#fff",
          borderRadius: 20,
          padding: 40,
          textAlign: "center",
          boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 32,
            color: "#0f172a",
          }}
        >
          BlockVote
        </h1>

        <p
          style={{
            marginTop: 12,
            color: "#64748b",
          }}
        >
          Blockchain Voting System
        </p>

        <button
          onClick={connectWallet}
          disabled={connecting}
          style={{
            width: "100%",
            marginTop: 30,
            padding: "15px",
            border: "none",
            borderRadius: 10,
            background: "#2563eb",
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            cursor: connecting
              ? "not-allowed"
              : "pointer",
            opacity: connecting ? 0.7 : 1,
          }}
        >
          {connecting
            ? "กำลังเชื่อมต่อ..."
            : "Connect Phantom"}
        </button>

        <a
          href="/scoreboard"
          style={{
            display: "block",
            marginTop: 16,
            color: "#2563eb",
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          ดูผลคะแนน (Scoreboard)
        </a>

        {walletAddress && (
          <p
            style={{
              marginTop: 16,
              fontSize: 12,
              color: "#64748b",
              wordBreak: "break-all",
            }}
          >
            {walletAddress}
          </p>
        )}
      </div>
    </main>
  );
}