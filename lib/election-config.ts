import { DEFAULT_ELECTION_ID } from "@/lib/election";

/*
 * Server-only: อ่าน/เขียน election_id ที่เปิดใช้งานทั้งเว็บ
 * เก็บใน Supabase ตาราง app_settings (key = "active_election")
 */

const SETTING_KEY = "active_election";

type StoredValue = {
  electionId: number;
  // เวลา (ms) ของคำขอที่ admin เซ็นไว้ ใช้กัน replay
  ts: number;
};

export type ActiveElection = {
  electionId: number;
  source: "db" | "default";
  ts: number | null;
};

// error code ที่แปลว่า "ยังไม่มีตาราง app_settings"
function isMissingTable(error: {
  code?: string;
}): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205"
  );
}

async function getClient() {
  const { supabaseAdmin } = await import(
    "@/lib/supabase-server"
  );

  return supabaseAdmin;
}

function parseStored(
  raw: unknown
): StoredValue | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const { electionId, ts } = raw as Record<
    string,
    unknown
  >;

  if (
    typeof electionId !== "number" ||
    !Number.isSafeInteger(electionId) ||
    electionId < 0
  ) {
    return null;
  }

  return {
    electionId,
    ts: typeof ts === "number" ? ts : 0,
  };
}

/*
 * ถ้ายังไม่เคยตั้งค่า (ไม่มีแถว / ยังไม่สร้างตาราง) => ใช้ค่า default
 * ถ้าอ่าน DB ไม่ได้เพราะสาเหตุอื่น => throw
 * (ไม่ fallback เงียบๆ เพื่อไม่ให้เว็บสลับไปใช้ election ผิดตัว)
 */
export async function getActiveElection(): Promise<ActiveElection> {
  const supabase = await getClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) {
      return {
        electionId: DEFAULT_ELECTION_ID,
        source: "default",
        ts: null,
      };
    }

    throw new Error(
      `อ่านค่า election จากฐานข้อมูลไม่สำเร็จ: ${error.message}`
    );
  }

  const stored = parseStored(data?.value);

  if (!stored) {
    return {
      electionId: DEFAULT_ELECTION_ID,
      source: "default",
      ts: null,
    };
  }

  return {
    electionId: stored.electionId,
    source: "db",
    ts: stored.ts,
  };
}

export async function getActiveElectionId(): Promise<number> {
  return (await getActiveElection()).electionId;
}

/*
 * ตั้ง election ที่เปิดใช้งาน
 * ts ต้องใหม่กว่าค่าที่เคยบันทึก (กันการ replay คำขอเก่า)
 */
export async function setActiveElectionId(
  electionId: number,
  ts: number
): Promise<void> {
  const supabase = await getClient();

  const { data: existing, error: readError } =
    await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SETTING_KEY)
      .maybeSingle();

  if (readError) {
    if (isMissingTable(readError)) {
      throw new Error(
        "ยังไม่ได้สร้างตาราง app_settings ใน Supabase (รันไฟล์ supabase/app_settings.sql ก่อน)"
      );
    }

    throw new Error(readError.message);
  }

  const previous = parseStored(existing?.value);

  if (previous && ts <= previous.ts) {
    throw new Error(
      "คำขอนี้เก่ากว่าการตั้งค่าล่าสุด กรุณาลองใหม่"
    );
  }

  const value: StoredValue = {
    electionId,
    ts,
  };

  const { error: writeError } = await supabase
    .from("app_settings")
    .upsert({
      key: SETTING_KEY,
      value,
      updated_at: new Date().toISOString(),
    });

  if (writeError) {
    throw new Error(writeError.message);
  }
}
