import React, { useEffect, useRef, useState, useMemo } from "react";
import "./MinerConsole.css";

function MinerConsole({ minerId, output, running, onClear }) {
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const frozen = useRef([]);
  const visible = paused ? frozen.current : output;
  const displayed = useMemo(
    () =>
      visible
        .filter((line) => line.toLowerCase().includes(query.toLowerCase()))
        .join(""),
    [visible, query],
  );
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
          {!running && output.length > 0 && (
            <span className="status-badge stopped">Stopped</span>
          )}
        </div>
        <div className="console-controls">
          <input
            aria-label="Filter console output"
            placeholder="Filter logs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="btn-clear"
            onClick={() => {
              frozen.current = output;
              setPaused(!paused);
            }}
          >
            {paused ? "Resume view" : "Pause view"}
          </button>
          <button
            className="btn-clear"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([displayed], { type: "text/plain" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `${minerId}-logs.txt`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Save logs
          </button>
          <button
            className="btn-scroll"
            onClick={scrollToTop}
            title="Scroll to top"
          >
            ⬆
          </button>
          <button
            className="btn-scroll"
            onClick={scrollToBottom}
            title="Scroll to bottom"
          >
            ⬇
          </button>
          <button className="btn-clear" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>

      <div className="console-output" ref={consoleRef} onScroll={handleScroll}>
        {output.length === 0 ? (
          <div className="console-empty">
            <p>
              No output yet. Configure and start the miner to see output here.
            </p>
          </div>
        ) : (
          <pre>{displayed || "No matching log lines."}</pre>
        )}
      </div>
    </div>
  );
}

export default MinerConsole;
