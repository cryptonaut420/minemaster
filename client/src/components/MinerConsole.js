import React, { useEffect, useRef } from 'react';
import './MinerConsole.css';

function MinerConsole({ minerId, output, running, onClear }) {
  const consoleRef = useRef(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    // Auto-scroll to bottom when new output arrives
    if (consoleRef.current && autoScrollRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [output]);

  const handleScroll = () => {
    if (consoleRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
      // Check if user is at the bottom (within 50px threshold)
      autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
    }
  };

  const scrollToTop = () => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = 0;
      autoScrollRef.current = false;
    }
  };

  const scrollToBottom = () => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
      autoScrollRef.current = true;
    }
  };

  return (
    <div className="miner-console">
      <div className="console-header">
        <div className="console-title">
          <span className="console-icon">▶_</span>
          <span>Console Output</span>
          {running && <span className="status-badge running">Running</span>}
          {!running && output.length > 0 && <span className="status-badge stopped">Stopped</span>}
        </div>
        <div className="console-controls">
          <button className="btn-scroll" onClick={scrollToTop} title="Scroll to top">
            ⬆
          </button>
          <button className="btn-scroll" onClick={scrollToBottom} title="Scroll to bottom">
            ⬇
          </button>
          <button className="btn-clear" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>
      
      <div 
        className="console-output" 
        ref={consoleRef}
        onScroll={handleScroll}
      >
        {output.length === 0 ? (
          <div className="console-empty">
            <p>No output yet. Configure and start the miner to see output here.</p>
          </div>
        ) : (
          <pre>{output.join('')}</pre>
        )}
      </div>
    </div>
  );
}

export default MinerConsole;
