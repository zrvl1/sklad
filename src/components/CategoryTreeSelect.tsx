"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type TreeOpt = { id: string; name: string; path: string; parentId: string | null };

/**
 * Вибір категорії деревом: згортання/розгортання гілок і пошук (за будь-якими словами зі шляху).
 * mode "path" — у форму йде повний шлях (і можна вписати нову назву, якщо allowFree);
 * mode "id"   — у форму йде ID категорії (наприклад, батьківський розділ).
 */
export default function CategoryTreeSelect({
  options,
  name,
  mode = "path",
  value,
  defaultValue = "",
  onChange,
  placeholder = "почніть вводити або оберіть зі списку",
  emptyLabel,
  allowFree = false,
  exclude,
  style,
  required,
}: {
  options: TreeOpt[];
  name?: string;
  mode?: "path" | "id";
  value?: string; // керований режим: шлях (path) або ID (id)
  defaultValue?: string;
  onChange?: (val: string, opt: TreeOpt | null) => void;
  placeholder?: string;
  emptyLabel?: string; // напр. «— верхній рівень —»: дозволяє обрати порожнє значення
  allowFree?: boolean;
  exclude?: (o: TreeOpt) => boolean;
  style?: object;
  required?: boolean;
}) {
  const opts = useMemo(() => (exclude ? options.filter((o) => !exclude(o)) : options), [options, exclude]);
  const byId = useMemo(() => new Map(opts.map((o) => [o.id, o])), [opts]);
  const toText = (v: string) => (mode === "id" ? byId.get(v)?.path ?? "" : v);

  const [inner, setInner] = useState(defaultValue);
  const val = value ?? inner; // шлях або ID
  const [text, setText] = useState(toText(val));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);

  // зовнішня зміна значення
  useEffect(() => {
    if (!open) setText(toText(val));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val]);

  // закрити при кліку поза списком
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  });

  const children = useMemo(() => {
    const m = new Map<string | null, TreeOpt[]>();
    for (const o of opts) {
      const p = o.parentId && byId.has(o.parentId) ? o.parentId : null;
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(o);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, "uk"));
    return m;
  }, [opts, byId]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // при пошуку: збіги + їхні предки (щоб було видно, де категорія лежить)
  const visible = useMemo(() => {
    if (!words.length) return null;
    const hit = new Set<string>();
    const show = new Set<string>();
    for (const o of opts) {
      const p = o.path.toLowerCase();
      if (words.every((w) => p.includes(w))) {
        hit.add(o.id);
        let cur: TreeOpt | undefined = o;
        while (cur) {
          show.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }
    return { hit, show };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, opts, byId]);

  const selectedId = mode === "id" ? val : opts.find((o) => o.path === val)?.id;

  const openList = () => {
    // розгорнути гілку обраної категорії
    if (selectedId) {
      const s = new Set(expanded);
      let cur = byId.get(selectedId);
      while (cur?.parentId) {
        s.add(cur.parentId);
        cur = byId.get(cur.parentId);
      }
      setExpanded(s);
    }
    setQuery("");
    setOpen(true);
  };

  const commit = (o: TreeOpt | null) => {
    const v = o ? (mode === "id" ? o.id : o.path) : "";
    if (value === undefined) setInner(v);
    setText(o?.path ?? "");
    onChange?.(v, o);
    setOpen(false);
    setQuery("");
  };

  function close() {
    setOpen(false);
    if (allowFree && mode === "path" && query.trim()) {
      // вписана назва нової категорії
      const t = text.trim();
      if (value === undefined) setInner(t);
      onChange?.(t, opts.find((o) => o.path === t) ?? null);
    } else setText(toText(val));
    setQuery("");
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const firstHit = visible ? opts.find((o) => visible.hit.has(o.id)) : undefined;

  const renderLevel = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((o) => {
      if (visible && !visible.show.has(o.id)) return null;
      const kids = children.get(o.id) ?? [];
      const isOpen = visible ? true : expanded.has(o.id);
      const isHit = visible?.hit.has(o.id);
      return (
        <div key={o.id}>
          <div
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (visible && !isHit ? toggle(o.id) : commit(o))}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "4px 6px",
              paddingLeft: 6 + depth * 18,
              cursor: "pointer",
              background: o.id === selectedId ? "#e0ecff" : undefined,
              opacity: visible && !isHit ? 0.55 : 1,
              borderRadius: 4,
            }}
            className="tree-opt"
          >
            {kids.length ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (!visible) toggle(o.id);
                }}
                style={{ width: 18, display: "inline-block", textAlign: "center", color: "#555" }}
              >
                {isOpen ? "▾" : "▸"}
              </span>
            ) : (
              <span style={{ width: 18, display: "inline-block" }} />
            )}
            <span style={{ fontWeight: kids.length ? 600 : 400 }}>{o.name}</span>
            {kids.length > 0 && <span className="small muted" style={{ marginLeft: 6 }}>({kids.length})</span>}
          </div>
          {kids.length > 0 && isOpen && renderLevel(o.id, depth + 1)}
        </div>
      );
    });

  return (
    <div ref={box} style={{ position: "relative", ...(style ?? {}) }}>
      <input
        value={text}
        name={mode === "path" ? name : undefined}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={openList}
        onBlur={() => open && close()}
        onClick={() => !open && openList()}
        onChange={(e) => {
          setText(e.target.value);
          setQuery(e.target.value);
          if (!open) setOpen(true);
          if (allowFree && mode === "path") {
            if (value === undefined) setInner(e.target.value);
            onChange?.(e.target.value, opts.find((o) => o.path === e.target.value) ?? null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Enter" && open) {
            e.preventDefault();
            if (firstHit) commit(firstHit);
            else close();
          }
        }}
        style={{ width: "100%" }}
      />
      {mode === "id" && name && <input type="hidden" name={name} value={val} />}
      {open && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.preventDefault() /* усередині <label> клік не повинен «натискати» поле */}
          style={{
            position: "absolute",
            zIndex: 50,
            top: "100%",
            left: 0,
            minWidth: "100%",
            width: "max-content",
            maxWidth: "min(640px, 90vw)",
            maxHeight: 380,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid var(--line, #ddd)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            padding: 4,
            marginTop: 2,
            fontWeight: 400,
          }}
        >
          {!visible && (
            <div className="row small" style={{ gap: 8, padding: "2px 6px 6px", borderBottom: "1px solid var(--line, #eee)", marginBottom: 4 }}>
              <a href="#" onMouseDown={(e) => e.preventDefault()} onClick={(e) => (e.preventDefault(), setExpanded(new Set(opts.map((o) => o.id))))}>
                розгорнути все
              </a>
              <a href="#" onMouseDown={(e) => e.preventDefault()} onClick={(e) => (e.preventDefault(), setExpanded(new Set()))}>
                згорнути все
              </a>
            </div>
          )}
          {emptyLabel !== undefined && !visible && (
            <div onMouseDown={(e) => e.preventDefault()} onClick={() => commit(null)} style={{ padding: "4px 6px", cursor: "pointer" }} className="tree-opt muted">
              {emptyLabel}
            </div>
          )}
          {renderLevel(null, 0)}
          {visible && visible.hit.size === 0 && (
            <div className="small muted" style={{ padding: 6 }}>
              {allowFree ? "Такої категорії немає — буде створено нову (оберіть розділ нижче)" : "Нічого не знайдено"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
