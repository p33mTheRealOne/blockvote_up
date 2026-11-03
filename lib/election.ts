// Election เริ่มต้น (fallback)
//
// election ที่ใช้งานจริงทั้งเว็บถูกเก็บไว้ใน Supabase (ตาราง app_settings)
// และเปลี่ยนได้จากหน้า /admin โดยไม่ต้องแก้โค้ด
// ค่านี้ใช้เฉพาะตอนที่ admin ยังไม่เคยตั้งค่าเท่านั้น
export const DEFAULT_ELECTION_ID = 8;

// Wallet admin — ต้องตรงกับ ADMIN_PUBKEY ใน smart contract (programs/blockvote/src/lib.rs)
export const ADMIN_WALLET =
  "Fo2UJytmzSxKCV9gnu1YE2aWsZqDBN6XaKDdhwckiTYV";

// ข้อความที่ admin ต้องเซ็นด้วย Phantom เมื่อเปลี่ยน election ของทั้งเว็บ
// (ใช้ร่วมกันระหว่างหน้า admin และ API /api/admin/election-id)
export function buildSetElectionMessage(
  electionId: number,
  timestamp: number
): string {
  return `BlockVote admin: set active election to ${electionId} at ${timestamp}`;
}
