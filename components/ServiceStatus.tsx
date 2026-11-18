"use client";

import type { ServiceState, ServiceStatus } from "@/lib/services";

const DOT: Record<ServiceState, string> = {
  ok: "bg-[oklch(72%_0.15_150)]",
  down: "bg-danger",
  off: "bg-rule",
};

const STATE_LABEL: Record<ServiceState, string> = {
  ok: "利用可",
  down: "停止中",
  off: "未設定",
};

// 状態は画面側で 1 か所だけ取りに行き、使えない操作を止めるのにも使う。
export function ServiceStatusBar({ services }: { services: ServiceStatus[] }) {
  const down = services.filter((service) => service.state === "down");
  if (services.length === 0) return null;

  return (
    <section aria-label="AI の接続状況" className="flex flex-col gap-1 text-xs text-ink-2">
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {services.map(({ id, label, state }) => (
          <li key={id} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2 rounded-full ${DOT[state]}`} />
            {label}: {STATE_LABEL[state]}
          </li>
        ))}
      </ul>
      {down.map(({ id, label, impact }) => (
        <p key={id} role="alert" className="text-danger">
          {label}のサーバに接続できません。{impact}
        </p>
      ))}
    </section>
  );
}
