import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = window.location.hostname === 'localhost'
  ? 'ws://localhost:3001'
  : `ws://${window.location.host}`;

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
    const maxReconnectAttempts = 20;
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

        ws.onerror = (error) => {
          // Connection error - will trigger onclose
        };

        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          
          // Attempt to reconnect
          if (!isUnmounting && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), 30000);
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
