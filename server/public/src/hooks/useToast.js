import { useState, useCallback } from "react";

let toastIdCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback(
    (message, type = "success", duration = 3000) => {
      const id = ++toastIdCounter;
      const toast = { id, message, type, duration };

      setToasts((prev) => [...prev.slice(-3), toast]);

      return id;
    },
    [],
  );

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const updateToast = useCallback(
    (id, message, type = "success", duration = 5000) => {
      setToasts((prev) => {
        const toast = { id, message, type, duration };
        return prev.some((t) => t.id === id)
          ? prev.map((t) => (t.id === id ? toast : t))
          : [...prev.slice(-3), toast];
      });
    },
    [],
  );

  const success = useCallback(
    (message, duration) => {
      return showToast(message, "success", duration);
    },
    [showToast],
  );

  const error = useCallback(
    (message, duration) => {
      return showToast(message, "error", duration);
    },
    [showToast],
  );

  const info = useCallback(
    (message, duration) => {
      return showToast(message, "info", duration);
    },
    [showToast],
  );

  return {
    toasts,
    showToast,
    updateToast,
    dismissToast,
    success,
    error,
    info,
  };
}
