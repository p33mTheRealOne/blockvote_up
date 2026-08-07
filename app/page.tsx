"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { isVoterRegistered } from "@/lib/solana-program";

type AccessState = "checking" | "disconnected" | "connected";

export default function Home() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  // After any successful connect (silent or manual), decide where the
  // wallet should land: already-verified wallets skip straight to
  // /vote instead of being asked to verify again.
  async function handleConnectedWallet(address: string) {
    setWalletAddress(address);

    try {
      const registered = await isVoterRegistered(address);
      if (registered) {
        router.push("/vote");
        return;
      }
    } catch (err) {
      console.error("Failed to check voter registration:", err);
      // Fall through to the normal "not yet verified" state — if the
      // chain check fails we shouldn't block someone from at least
      // attempting to verify.
    }

    setAccessState("connected");
  }

  // On page load, try a *silent* reconnect (onlyIfTrusted: true) —
  // Phantom remembers which sites the user previously approved, so
  // this restores the session with no popup and no extra click if
  // they connected before, even after closing and reopening the
  // browser. If Phantom hasn't seen this site before (or the user
  // disconnected), this just fails quietly and we show the normal
  // "Connect Phantom" button.
  useEffect(() => {
    let cancelled = false;

    async function tryRestoreSession() {
      if (typeof window === "undefined" || !("solana" in window)) {
        if (!cancelled) setAccessState("disconnected");
        return;
      }

      const provider = (window as { solana?: any }).solana;

      if (!provider?.isPhantom) {
        if (!cancelled) setAccessState("disconnected");
        return;
      }

      try {
        const response = await provider.connect({ onlyIfTrusted: true });
        if (cancelled) return;
        await handleConnectedWallet(response.publicKey.toString());
      } catch {
        // Not previously trusted — normal disconnected state.
        if (!cancelled) setAccessState("disconnected");
      }
    }

    tryRestoreSession();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectPhantom = async () => {
    if (typeof window !== "undefined" && "solana" in window) {
      const provider = (window as { solana?: any }).solana;

      if (provider?.isPhantom) {
        try {
          const response = await provider.connect();
          await handleConnectedWallet(response.publicKey.toString());
        } catch (err) {
          console.error(err);
        }
      }
    } else {
      window.open("https://phantom.app/", "_blank");
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-blue-100 p-8">
        {accessState === "checking" && (
          <div className="py-10 flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-blue-50 animate-pulse" />
            <p className="text-sm text-slate-400">กำลังตรวจสอบการเชื่อมต่อ…</p>
          </div>
        )}

        {accessState === "disconnected" && (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
                <Image src="/phantom.png" width={36} height={36} alt="Phantom" />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-center text-slate-800">
              Connect Wallet
            </h1>

            <p className="text-center text-slate-500 mt-2 mb-8">
              Connect your Phantom Wallet to continue.
            </p>

            <button
              onClick={handleConnectPhantom}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition"
            >
              Connect Phantom
            </button>
          </>
        )}

        {accessState === "connected" && walletAddress && (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl">
                ✅
              </div>
            </div>

            <h1 className="text-2xl font-bold text-center text-slate-800">
              Wallet Connected
            </h1>

            <p className="text-center text-slate-500 mt-2">
              {formatAddress(walletAddress)}
            </p>

            <div className="mt-8 p-5 rounded-2xl bg-blue-50 border border-blue-200">
              <h2 className="font-bold text-blue-700 text-lg">
                Identity Verification
              </h2>

              <p className="text-slate-600 mt-2 text-sm">
                Before you can vote, we need to verify your identity to
                ensure that each eligible voter can vote only once.
              </p>

              <ul className="mt-5 space-y-2 text-sm text-slate-700">
                <li>🪪 Scan Thai National ID Card</li>
                <li>📷 Face Verification</li>
                <li>✅ Verify Eligibility</li>
              </ul>

              <button
                onClick={() => router.push("/verify")}
                className="mt-6 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition"
              >
                Start Identity Verification
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}