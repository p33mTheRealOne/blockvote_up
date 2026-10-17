"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Wallet } from "lucide-react";

import SiteNav from "@/components/SiteNav";
import Shell from "@/components/Shell";
import { IconArrowRight } from "@/components/icons";

const ADMIN_WALLET =
  "Fo2UJytmzSxKCV9gnu1YE2aWsZqDBN6XaKDdhwckiTYV";

const STEPS = [
  {
    title: "เชื่อมกระเป๋า Phantom",
    text: "กดปุ่มด้านล่าง ระบบพาไปขั้นต่อไปเอง",
  },
  {
    title: "ยืนยันบัตรและใบหน้า",
    text: "หนึ่งคนมีสิทธิ์โหวตหนึ่งครั้ง",
  },
  {
    title: "เลือกพรรคแล้วยืนยัน",
    text: "เก็บ nonce ไว้ใช้ตอนเปิดเผยผล",
  },
];

export default function ConnectWallet() {
  const router = useRouter();

  const [walletAddress, setWalletAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState("");

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
      setNotice("");

      const provider = (window as any).phantom?.solana;

      if (!provider) {
        setNotice("กรุณาติดตั้ง Phantom Wallet ก่อน");
        return;
      }

      const response = await provider.connect();

      const address = response.publicKey.toString();

      setWalletAddress(address);

      // Connect สำเร็จ → redirect ทันที
      redirectByWallet(address);
    } catch (error) {
      console.error("Wallet connection failed:", error);
      setNotice("เชื่อมต่อกระเป๋าไม่สำเร็จ กรุณาลองอีกครั้ง");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <SiteNav />

      <Shell>
        <main className="hm-main">
          <section>
            <h1 className="hm-h1">
              ลงคะแนนให้จบใน 3 ขั้น
            </h1>

            <p className="hm-lead">
              ใช้ Phantom Wallet ยืนยันตัวตน แล้วเลือกพรรค
              คะแนนถูกบันทึกบนเชน Solana
            </p>
          </section>

          <section aria-label="ขั้นตอน">
            <ol className="hm-ballot">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  style={{
                    gridTemplateColumns:
                      "2.5rem minmax(0, 1fr)",
                  }}
                >
                  <span className="hm-num">
                    {index + 1}
                  </span>

                  <span className="hm-name">
                    {step.title}

                    <span className="hm-sub">
                      {step.text}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="hm-actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <button
              type="button"
              onClick={connectWallet}
              disabled={connecting}
              aria-busy={connecting}
              className="hm-btn hm-btn--solid hm-btn--block"
            >
              {connecting ? (
                <>
                  <Loader2
                    className="animate-spin"
                    size={18}
                  />
                  กำลังเชื่อมต่อ…
                </>
              ) : (
                <>
                  <Wallet size={18} />
                  เชื่อม Phantom
                </>
              )}
            </button>

            {notice && (
              <div
                role="alert"
                className="hm-note hm-note--error"
              >
                <p>
                  <strong>เชื่อมต่อไม่สำเร็จ</strong>
                </p>

                <p>{notice}</p>

                {notice.includes("Phantom") && (
                  <a
                    href="https://phantom.app/download"
                    target="_blank"
                    rel="noreferrer"
                    className="hm-link"
                  >
                    ดาวน์โหลด Phantom
                  </a>
                )}
              </div>
            )}

            <Link href="/scoreboard" className="hm-link">
              ดูผลคะแนน
              <IconArrowRight size={16} />
            </Link>

            {walletAddress && (
              <p
                className="hm-label"
                style={{ overflowWrap: "anywhere", margin: 0 }}
              >
                {walletAddress}
              </p>
            )}
          </section>
        </main>
      </Shell>
    </>
  );
}
