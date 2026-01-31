import React, { useState, useEffect, useCallback } from 'react';
import { configsAPI } from '../services/api';
import { useToast } from '../hooks/useToast';
import ToastContainer from './ToastContainer';
import './Configs.css';

function Configs() {
  const [configs, setConfigs] = useState({});
  const [selectedType, setSelectedType] = useState('xmrig');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({});
  const { toasts, success, error, dismissToast } = useToast();

  useEffect(() => {
    fetchConfigs();
  }, []);

  useEffect(() => {
    if (configs[selectedType]) {
      setFormData(configs[selectedType]);
    } else {
      setFormData({});
    }
  }, [selectedType, configs]);

  const fetchConfigs = async () => {
    try {
      const response = await configsAPI.getAll();
      setConfigs(response.data.configs || {});
      setLoading(false);
    } catch (error) {
      console.error('Error fetching configs:', error);
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await configsAPI.update(selectedType, formData);
      await fetchConfigs();
      const deviceName = selectedType === 'xmrig' ? 'CPU (XMRig)' : 'GPU (Nanominer)';
      success(`${deviceName} configuration saved successfully!`, 4000);
    } catch (err) {
      error(`Failed to save configuration: ${err.response?.data?.error || err.message}`, 5000);
      console.error('Error saving config:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="configs-loading">
        <div className="loading-spinner"></div>
        <p>Loading configurations...</p>
      </div>
    );
  }

  return (
    <div className="configs">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      
      <div className="configs-header">
        <div className="header-left">
          <h2>Global Configurations</h2>
          <p className="subtitle">Configure mining settings for all connected clients</p>
        </div>
      </div>

      <div className="config-tabs">
        <button
          className={selectedType === 'xmrig' ? 'active' : ''}
          onClick={() => setSelectedType('xmrig')}
        >
          <span className="tab-icon">🖥️</span>
          <span className="tab-label">XMRig</span>
          <span className="tab-desc">CPU Mining</span>
        </button>
        <button
          className={selectedType === 'nanominer' ? 'active' : ''}
          onClick={() => setSelectedType('nanominer')}
        >
          <span className="tab-icon">🎮</span>
          <span className="tab-label">Nanominer</span>
          <span className="tab-desc">GPU Mining</span>
        </button>
      </div>

      <div className="config-panel">
        {selectedType === 'xmrig' && (
          <XmrigConfig formData={formData} onChange={handleChange} />
        )}
        {selectedType === 'nanominer' && (
          <NanominerConfig formData={formData} onChange={handleChange} />
        )}

        <div className="config-actions">
          <div className="action-buttons">
            <button
              className="btn btn-save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : '💾 Save Configuration'}
            </button>
          </div>
          
          <p className="action-hint">
            Configuration saved. Restart miners manually to apply changes.
          </p>
        </div>
      </div>
    </div>
  );
}

// XMRig Config Form (matches client MinerConfig.js)
function XmrigConfig({ formData, onChange }) {
  return (
    <div className="config-form">
      <h3 className="form-section-title">Pool & Wallet</h3>
      
      <div className="form-row">
        <div className="form-group">
          <label>Coin / Currency</label>
          <input
            type="text"
            value={formData.coin || ''}
            onChange={(e) => onChange('coin', e.target.value.toUpperCase())}
            placeholder="XMR"
          />
          <span className="field-hint">Symbol of the cryptocurrency</span>
        </div>
        
        <div className="form-group">
          <label>Algorithm</label>
          <select
            value={formData.algorithm || 'rx/0'}
            onChange={(e) => onChange('algorithm', e.target.value)}
          >
            <option value="rx/0">RandomX (rx/0)</option>
            <option value="rx/wow">RandomWOW (rx/wow)</option>
            <option value="rx/arq">RandomARQ (rx/arq)</option>
            <option value="cn/r">CryptoNight R (cn/r)</option>
            <option value="cn/half">CryptoNight Half (cn/half)</option>
            <option value="ghostrider">GhostRider</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>Pool Address</label>
        <input
          type="text"
          value={formData.pool || ''}
          onChange={(e) => onChange('pool', e.target.value)}
          placeholder="pool.example.com:3333"
        />
        <span className="field-hint">Format: hostname:port</span>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Wallet Address / Username</label>
          <input
            type="text"
            value={formData.user || ''}
            onChange={(e) => onChange('user', e.target.value)}
            placeholder="Your wallet address"
          />
        </div>

        <div className="form-group">
          <label>Password</label>
          <input
            type="text"
            value={formData.password || ''}
            onChange={(e) => onChange('password', e.target.value)}
            placeholder="x"
          />
          <span className="field-hint">Usually 'x' or worker name</span>
        </div>
      </div>

      <h3 className="form-section-title">Performance</h3>

      <div className="form-group">
        <label>
          CPU Usage: <span className="highlight">{formData.threadPercentage || 100}%</span>
        </label>
        <div className="slider-container">
          <input
            type="range"
            min="10"
            max="100"
            step="10"
            value={formData.threadPercentage || 100}
            onChange={(e) => onChange('threadPercentage', parseInt(e.target.value))}
            className="slider"
          />
          <div className="slider-labels">
            <span>10%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
        <span className="field-hint">Percentage of available CPU threads to use</span>
      </div>

      <h3 className="form-section-title">Advanced</h3>

      <div className="form-group">
        <label>Additional Arguments</label>
        <input
          type="text"
          value={formData.additionalArgs || ''}
          onChange={(e) => onChange('additionalArgs', e.target.value)}
          placeholder="--tls --keepalive"
        />
        <span className="field-hint">Extra command line arguments passed to XMRig</span>
      </div>
    </div>
  );
}

// Nanominer Config Form (matches client NanominerConfig.js)
function NanominerConfig({ formData, onChange }) {
  return (
    <div className="config-form">
      <h3 className="form-section-title">Pool & Wallet</h3>
      
      <div className="form-row">
        <div className="form-group">
          <label>Coin / Currency</label>
          <input
            type="text"
            value={formData.coin || ''}
            onChange={(e) => onChange('coin', e.target.value.toUpperCase())}
            placeholder="RVN"
          />
          <span className="field-hint">Symbol of the cryptocurrency</span>
        </div>
        
        <div className="form-group">
          <label>Algorithm</label>
          <select
            value={formData.algorithm || 'kawpow'}
            onChange={(e) => onChange('algorithm', e.target.value)}
          >
            <option value="ethash">Ethash (ETH, ETC, UBQ, EXP)</option>
            <option value="etchash">Etchash (ETC)</option>
            <option value="kawpow">KawPow (RVN)</option>
            <option value="autolykos">Autolykos (ERG)</option>
            <option value="conflux">Octopus (CFX)</option>
            <option value="ton">TON</option>
            <option value="kaspa">Kaspa (KAS)</option>
            <option value="karlsenhash">Karlsen (KLS)</option>
            <option value="nexa">Nexa</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>Pool Address</label>
        <input
          type="text"
          value={formData.pool || ''}
          onChange={(e) => onChange('pool', e.target.value)}
          placeholder="rvn.2miners.com:6060"
        />
        <span className="field-hint">Format: hostname:port</span>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Wallet Address</label>
          <input
            type="text"
            value={formData.user || ''}
            onChange={(e) => onChange('user', e.target.value)}
            placeholder="Your wallet address"
          />
        </div>

        <div className="form-group">
          <label>Rig Name</label>
          <input
            type="text"
            value={formData.rigName || ''}
            onChange={(e) => onChange('rigName', e.target.value)}
            placeholder="worker1"
          />
          <span className="field-hint">Identifier for this worker (optional)</span>
        </div>
      </div>

      <div className="info-box">
        <span className="info-icon">ℹ️</span>
        <div className="info-content">
          <strong>GPU Selection</strong>
          <p>GPU devices are configured individually on each client. This global config sets the pool and wallet settings that all clients will use.</p>
        </div>
      </div>
    </div>
  );
}

export default Configs;
