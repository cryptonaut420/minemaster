import React from 'react';
import './NotificationContainer.css';

/**
 * Toast notification display container
 */
function NotificationContainer({ notifications, onDismiss }) {
  if (!notifications || notifications.length === 0) return null;

  return (
    <div className="notification-container">
      {notifications.map(notification => (
        <div 
          key={notification.id} 
          className={`notification notification-${notification.type}`}
        >
          <div className="notification-icon">
            {notification.type === 'success' && '✓'}
            {notification.type === 'error' && '✕'}
            {notification.type === 'warning' && '⚠'}
            {notification.type === 'info' && 'ℹ'}
          </div>
          <div className="notification-message">{notification.message}</div>
          <button 
            className="notification-close"
            onClick={() => onDismiss(notification.id)}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export default NotificationContainer;
