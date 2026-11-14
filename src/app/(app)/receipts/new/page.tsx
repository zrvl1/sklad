import { createReceipt } from "../actions";

// Сторінка-проміжок: одна кнопка створює чернетку й відкриває її
export default function NewReceiptPage() {
  return (
    <div className="panel" style={{ maxWidth: 420 }}>
      <h1>Новий прихід</h1>
      <form action={createReceipt}>
        <button className="btn primary" autoFocus>
          Створити документ приходу
        </button>
      </form>
    </div>
  );
}
