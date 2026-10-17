"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: PublicKey;

  connect: (options?: {
    onlyIfTrusted?: boolean;
  }) => Promise<{ publicKey: PublicKey }>;

  disconnect: () => Promise<void>;

  on: (
    event: string,
    callback: (publicKey: PublicKey | null) => void
  ) => void;

  removeListener: (
    event: string,
    callback: (publicKey: PublicKey | null) => void
  ) => void;
}

export default function WalletConnect() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const getProvider = () => {
    if (typeof window === "undefined") return null;

    const provider = window.solana;

    if (!provider?.isPhantom) {
      return null;
    }

    return provider;
  };

  // Reconnect automatically when the page loads
  useEffect(() => {
    const provider = getProvider();

    if (!provider) return;

    const reconnect = async () => {
      try {
        const response = await provider.connect({
          onlyIfTrusted: true,
        });

        setWalletAddress(response.publicKey.toString());
      } catch {
        // User has not previously connected
      }
    };

    reconnect();

    const handleAccountChanged = (publicKey: PublicKey | null) => {
      if (publicKey) {
        setWalletAddress(publicKey.toString());
      } else {
        setWalletAddress(null);
      }
    };

    provider.on("accountChanged", handleAccountChanged);

    return () => {
      provider.removeListener("accountChanged", handleAccountChanged);
    };
  }, []);

  const connectWallet = async () => {
    const provider = getProvider();

    if (!provider) {
      window.open("https://phantom.app/", "_blank");
      return;
    }

    try {
      setConnecting(true);

      const response = await provider.connect();

      setWalletAddress(response.publicKey.toString());
    } catch (error) {
      console.error("Wallet connection failed:", error);
    } finally {
      setConnecting(false);
    }
  };

  const disconnectWallet = async () => {
    const provider = getProvider();

    if (!provider) return;

    try {
      await provider.disconnect();
      setWalletAddress(null);
    } catch (error) {
      console.error("Wallet disconnect failed:", error);
    }
  };

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <div className="wallet-page">
      <div className="background-circle circle-one" />
      <div className="background-circle circle-two" />

      <main className="wallet-container">
        <div className="logo">
          <div className="logo-icon">
            ✓
          </div>
          <span>BlockVote</span>
        </div>

        <section className="wallet-card">
          <div className="card-icon">
            <svg
              width="42"
              height="42"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 7V6a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v8a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V7" />
              <path d="M16 14h.01" />
            </svg>
          </div>

          <h1>Connect your wallet</h1>

          <p className="subtitle">
            Connect your Phantom wallet to participate
            <br />
            in the election.
          </p>

          {walletAddress ? (
            <>
              <div className="connected-box">
                <div className="status-dot" />

                <div className="connected-info">
                  <span className="connected-label">
                    Wallet connected
                  </span>

                  <span className="wallet-address">
                    {shortenAddress(walletAddress)}
                  </span>
                </div>

                <div className="check">
                  ✓
                </div>
              </div>

              <button
                className="disconnect-button"
                onClick={disconnectWallet}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="connect-button"
              onClick={connectWallet}
              disabled={connecting}
            >
              {connecting ? (
                <>
                  <span className="spinner" />
                  Connecting...
                </>
              ) : (
                <>
                  <span className="phantom-icon">
                    ◈
                  </span>
                  Connect Phantom
                </>
              )}
            </button>
          )}

          <div className="security-note">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>

            <span>
              Your wallet remains under your control.
            </span>
          </div>
        </section>

        <p className="footer-text">
          Powered by Solana
        </p>
      </main>
    </div>
  );
}