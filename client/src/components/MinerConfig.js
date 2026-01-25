import React from 'react';
import './MinerConfig.css';

function MinerConfig({ miner, onConfigChange, onStart, onStop }) {
  const handleChange = (field, value) => {
    onConfigChange({
      ...miner.config,
      [field]: value
    });
  };

  return (
    <div className="miner-config">
      <div className="config-header">
        <h2>{miner.name}</h2>
        <div className="control-buttons">
          {!miner.running ? (
            <button 
              className="btn btn-start"
              onClick={onStart}
              disabled={!miner.config.pool || !miner.config.user}
              title={!miner.config.pool || !miner.config.user ? 'Pool address and wallet address required' : ''}
            >
              ▶ Start Mining
            </button>
          ) : (
            <button 
              className="btn btn-stop"
              onClick={onStop}
            >
              ⏹ Stop Mining
            </button>
          )}
        </div>
      </div>

      <div className="config-form">
        <div className="form-group">
          <label>Pool Address</label>
          <input
            type="text"
            placeholder="pool.example.com:3333"
            value={miner.config.pool}
            onChange={(e) => handleChange('pool', e.target.value)}
            disabled={miner.running}
          />
        </div>

        <div className="form-row">
        <div className="form-group">
          <label>Wallet Address / Username</label>
          <input
            type="text"
            placeholder="Your wallet address"
            value={miner.config.user}
            onChange={(e) => handleChange('user', e.target.value)}
            disabled={miner.running}
          />
        </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="text"
              placeholder="x"
              value={miner.config.password}
              onChange={(e) => handleChange('password', e.target.value)}
              disabled={miner.running}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Algorithm</label>
            <select
              value={miner.config.algorithm}
              onChange={(e) => handleChange('algorithm', e.target.value)}
              disabled={miner.running}
            >
              <option value="rx/0">RandomX (rx/0)</option>
              <option value="rx/wow">RandomWOW (rx/wow)</option>
              <option value="rx/arq">RandomARQ (rx/arq)</option>
              <option value="cn/r">CryptoNight R (cn/r)</option>
              <option value="cn/half">CryptoNight Half (cn/half)</option>
              <option value="ghostrider">GhostRider</option>
            </select>
          </div>

          <div className="form-group">
            <label>Threads (0 = auto)</label>
            <input
              type="number"
              min="0"
              value={miner.config.threads}
              onChange={(e) => handleChange('threads', parseInt(e.target.value) || 0)}
              disabled={miner.running}
            />
          </div>
        </div>

        <div className="form-group">
          <label>Additional Arguments (optional)</label>
          <input
            type="text"
            placeholder="--tls --keepalive"
            value={miner.config.additionalArgs}
            onChange={(e) => handleChange('additionalArgs', e.target.value)}
            disabled={miner.running}
          />
        </div>
      </div>
    </div>
  );
}

export default MinerConfig;
