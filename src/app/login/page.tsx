import { login } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <div className="login panel">
      <h1>Вхід</h1>
      {e === "locked" && <div className="msg err">Забагато невдалих спроб. Спробуйте через 15 хвилин.</div>}
      {e === "1" && <div className="msg err">Невірний логін або пароль</div>}
      <form action={login} style={{ display: "grid", gap: 12 }}>
        <label>
          Логін
          <input name="login" autoFocus required autoComplete="username" maxLength={100} />
        </label>
        <label>
          Пароль
          <input name="password" type="password" required autoComplete="current-password" maxLength={200} />
        </label>
        <button className="btn primary" type="submit">
          Увійти
        </button>
      </form>
    </div>
  );
}
