/*
 * Progress index — ตารางขั้นตอนแบบมีเส้นกั้น (ไม่ใช่วงกลมเชื่อมกัน)
 * current = index ของขั้นตอนปัจจุบัน (0-3), ขั้นก่อนหน้า = เสร็จแล้ว
 */

const STEPS = ["เชื่อมต่อ", "ยืนยัน", "โหวต", "ผลคะแนน"];

export default function Stepper({
  current,
}: {
  current: number;
}) {
  return (
    <ol
      className="hm-steps"
      aria-label="ขั้นตอนการลงคะแนน"
    >
      {STEPS.map((label, index) => (
        <li
          key={label}
          className={
            index < current
              ? "hm-step is-done"
              : index === current
                ? "hm-step is-active"
                : "hm-step"
          }
          aria-current={
            index === current ? "step" : undefined
          }
        >
          <b>{index + 1}</b>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
