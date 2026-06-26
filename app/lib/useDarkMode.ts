"use client";
import { useEffect, useState } from "react";

const STORAGE_KEY = "pulsr-dark-mode";

export function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const initial = localStorage.getItem(STORAGE_KEY) === "true";
    setDark(initial);
    document.documentElement.classList.toggle("dark", initial);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };

  return { dark, toggle };
}
