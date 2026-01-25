import { useState, useEffect } from 'react';

export function useSystemInfo() {
  const [systemInfo, setSystemInfo] = useState(() => {
    const cached = sessionStorage.getItem('minemaster-system-info');
    return cached ? JSON.parse(cached) : null;
  });

  useEffect(() => {
    const loadSystemInfo = async () => {
      if (window.electronAPI) {
        const info = await window.electronAPI.getSystemInfo();
        setSystemInfo(info);
        if (info) {
          sessionStorage.setItem('minemaster-system-info', JSON.stringify(info));
        }
      }
    };

    const cached = sessionStorage.getItem('minemaster-system-info');
    if (cached) {
      setSystemInfo(JSON.parse(cached));
    } else {
      loadSystemInfo();
    }

    const refetchTimeout = setTimeout(loadSystemInfo, 3000);
    return () => clearTimeout(refetchTimeout);
  }, []);

  return systemInfo;
}

export function useSystemStats() {
  const [systemStats, setSystemStats] = useState(null);

  useEffect(() => {
    let mounted = true;

    const updateStats = async () => {
      if (!mounted || !window.electronAPI) return;

      try {
        const [cpu, memory, gpu] = await Promise.all([
          window.electronAPI.getCpuStats(),
          window.electronAPI.getMemoryStats(),
          window.electronAPI.getGpuStats()
        ]);

        if (mounted) {
          setSystemStats({ cpu, memory, gpu });
        }
      } catch (e) {
        console.error('Stats update error:', e);
      }
    };

    const initialTimeout = setTimeout(updateStats, 2000);
    const interval = setInterval(updateStats, 3000);

    return () => {
      mounted = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  return systemStats;
}
