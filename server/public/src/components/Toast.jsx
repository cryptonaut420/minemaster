import React, { useEffect, useRef } from "react";
import "./Toast.css";

function Toast({ message, type = "success", onClose, duration = 3000 }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        close.current();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, message, type]);

  return (
    <div
      className={`toast toast-${type}`}
      role={type === "error" ? "alert" : "status"}
      aria-atomic="true"
      style={{ "--toast-duration": `${duration}ms` }}
    >
      <div className="toast-content">
        <span className="toast-icon" aria-hidden="true">
          {type === "success" && "✓"}
          {type === "error" && "✕"}
          {type === "info" && "ℹ"}
          {type === "warning" && "!"}
        </span>
        <span className="toast-message">{message}</span>
      </div>
      <button
        className="toast-close"
        onClick={onClose}
        aria-label="Close notification"
      >
        ×
      </button>
    </div>
  );
}

export default Toast;
