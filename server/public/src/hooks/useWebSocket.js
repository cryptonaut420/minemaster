import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = process.env.NODE_ENV === 'production' 
  ? `ws://${window.location.host}`
  : 'ws://localhost:3001';

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
          console.log('[WebSocket] Connected to server');
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
            console.error('[WebSocket] Error parsing message:', error);
          }
        };

        ws.onerror = (error) => {
          console.error('[WebSocket] Connection error');
        };

        ws.onclose = () => {
          console.log('[WebSocket] Disconnected');
          setConnected(false);
          wsRef.current = null;
          
          // Attempt to reconnect
          if (!isUnmounting && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), 30000);
            console.log(`[WebSocket] Reconnecting in ${Math.round(delay/1000)}s (attempt ${reconnectAttempts})`);
            reconnectTimeoutRef.current = setTimeout(connect, delay);
          }
        };
      } catch (error) {
        console.error('[WebSocket] Failed to create connection:', error);
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
