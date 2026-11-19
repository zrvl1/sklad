"use client";

/** Позначити / зняти всі галочки з іменем, що починається з prefix (у межах сторінки) */
export default function SelectAllButton({ prefix = "sel_", label = "позначити всі на сторінці" }: { prefix?: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn sm"
      onClick={() => {
        const boxes = [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name^="${prefix}"]`)];
        const all = boxes.every((b) => b.checked);
        boxes.forEach((b) => (b.checked = !all));
      }}
    >
      {label}
    </button>
  );
}
