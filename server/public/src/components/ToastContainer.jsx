import React from 'react';
import Toast from './Toast';
import './ToastContainer.css';

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => onDismiss(toast.id)}
          duration={toast.duration}
        />
      ))}
    </div>
  );
}

export default ToastContainer;
