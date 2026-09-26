"use client";
import { useEffect, useRef } from "react";

type BackHandlerOptions = {
  onBack: () => void;
  preventNavigation?: boolean;
};

export function useBackButton({
  onBack,
  preventNavigation = true,
}: BackHandlerOptions) {
  const callbackRef = useRef(onBack);

  useEffect(() => {
    callbackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!preventNavigation) return;

    window.history.pushState({ backHandled: true }, "");

    const handlePopState = (e: PopStateEvent) => {
      e.stopImmediatePropagation();
      window.history.pushState({ backHandled: true }, "");
      callbackRef.current();
    };

    window.addEventListener("popstate", handlePopState, true);
    return () => {
      window.removeEventListener("popstate", handlePopState, true);
    };
  }, [preventNavigation]);
}
