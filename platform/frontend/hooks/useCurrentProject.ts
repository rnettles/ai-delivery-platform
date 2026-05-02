"use client";

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "adp_current_project_id";

export function useCurrentProject() {
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(null);

  // Populate from localStorage after hydration (SSR-safe)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setCurrentProjectIdState(stored);
    } catch {
      // localStorage unavailable (e.g. private browsing restrictions)
    }
  }, []);

  const setCurrentProject = useCallback((id: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // silent
    }
    setCurrentProjectIdState(id);
  }, []);

  return { currentProjectId, setCurrentProject };
}
