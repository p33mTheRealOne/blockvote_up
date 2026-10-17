"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminDashboard from "@/components/AdminDashboard";

const ADMIN_WALLET =
  "Fo2UJytmzSxKCV9gnu1YE2aWsZqDBN6XaKDdhwckiTYV";


export default function AdminPage() {

  const router = useRouter();


  useEffect(() => {

    const checkWallet = async () => {

      if (
        typeof window === "undefined"
      ) {
        return;
      }


      const provider =
        window.phantom?.solana ??
        window.solana;


      if (!provider) {

        router.replace("/");

        return;
      }


      try {

        const response =
          await provider.connect({
            onlyIfTrusted: true,
          });


        const address =
          response.publicKey.toString();


        if (
          address !== ADMIN_WALLET
        ) {

          router.replace("/");

          return;
        }

      } catch {

        router.replace("/");

      }

    };


    checkWallet();

  }, [router]);


  return (
    <AdminDashboard />
  );
}