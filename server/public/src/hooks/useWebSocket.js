import { useEffect, useRef, useState, useCallback } from 'react';

// Derive WebSocket URL from current page location
// Uses wss:// when page is served over HTTPS (e.g. behind nginx-proxy with TLS)
// Uses ws:// when page is served over HTTP (e.g. localhost dev)
// In development, Vite proxy handles /ws -> ws://localhost:3001
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

export function useWebSocket(onMessage) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const onMessageRef = useRef(onMessage);

  // Keep the callback ref updated
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let reconnectAttempts = 0;
    let isUnmounting = false;

    function connect() {
      if (isUnmounting) return;
      
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          reconnectAttempts = 0;
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (onMessageRef.current) {
              onMessageRef.current(data);
            }
          } catch (error) {
            // Silent fail - malformed message
          }
        };

        ws.onerror = () => {
          // Connection error - will trigger onclose
        };

        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          
          // Always reconnect (24/7 dashboard) with exponential backoff capped at 30s
          if (!isUnmounting) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(1.5, Math.min(reconnectAttempts - 1, 15)), 30000);
            reconnectTimeoutRef.current = setTimeout(connect, delay);
          }
        };
      } catch (error) {
        // Connection failed - will retry
      }
    }

    connect();

    return () => {
      isUnmounting = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const send = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  return { connected, send };
}
