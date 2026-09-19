import React, { createContext, useContext, useMemo } from "react";
import { useToast } from "../hooks/useToast";
import ToastContainer from "./ToastContainer";

const Notifications = createContext(null);
export const useNotifications = () => useContext(Notifications);
export default function NotificationProvider({ children }) {
  const { toasts, showToast, updateToast, dismissToast, success, error, info } =
    useToast();
  const value = useMemo(
    () => ({ showToast, updateToast, dismissToast, success, error, info }),
    [showToast, updateToast, dismissToast, success, error, info],
  );
  return (
    <Notifications.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </Notifications.Provider>
  );
}
