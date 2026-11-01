"use client";

import { useEffect, useState } from "react";
import { checkServices, type ServiceStatus } from "@/lib/services";

const INTERVAL_MS = 15_000;

export function useServices() {
  const [services, setServices] = useState<ServiceStatus[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.hidden) return;
      const next = await checkServices();
      if (active) setServices(next);
    };
    void refresh();
    const timer = setInterval(refresh, INTERVAL_MS);
    // サーバを起動してアプリへ戻ったときに、すぐ反映する。
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return services;
}
