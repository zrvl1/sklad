import { requirePerm } from "@/lib/auth";

// Доступ до розділу лише з правом «reports» (див. ролі в src/lib/auth.ts)
export default async function Guard({ children }: { children: React.ReactNode }) {
  await requirePerm("reports");
  return <>{children}</>;
}
