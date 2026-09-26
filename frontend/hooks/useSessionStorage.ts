import { useState } from "react";

type SetValue<T> = T | ((prev: T) => T);

export default function useSessionStorage<T>(
  key: string,
  defaultValue: T
): [T, (value: SetValue<T>) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    const saved = sessionStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : defaultValue;
  });

  const setStateAndSave = (value: SetValue<T>) => {
    const newValue = value instanceof Function ? value(state) : value;
    setState(newValue);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(key, JSON.stringify(newValue));
    }
  };

  return [state, setStateAndSave];
}
