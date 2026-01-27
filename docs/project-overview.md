# MineMaster Project Overview

A comprehensive technical overview of the MineMaster cryptocurrency mining application.

## 🎯 Project Vision

MineMaster aims to democratize cryptocurrency mining by providing an accessible, user-friendly interface for managing mining operations. It removes the complexity of command-line mining software while preserving full control and transparency.

## 📊 Project Status

**Current Version**: 1.0.0
**Status**: Production Ready
**License**: Open Source (To be determined)
**Platform Support**: Linux, Windows, macOS

## 🏗️ Technology Stack

### Frontend
- **Framework**: React 18.2.0
- **State Management**: React Hooks + localStorage
- **Styling**: CSS3 with component-scoped stylesheets
- **Build Tool**: react-scripts 5.0.1
- **Terminal Emulation**: xterm.js 5.3.0

### Backend
- **Runtime**: Node.js (v16+)
- **Desktop Framework**: Electron 28.1.0
- **Process Management**: Node.js child_process
- **System Information**: systeminformation 5.21.20
- **IPC**: Electron IPC (contextBridge + ipcRenderer)

### Mining Software
- **CPU**: XMRig 6.25.0
- **GPU**: Nanominer 3.9.2

## 📦 Project Structure

```
minemaster/
├── client/                       # Main application
│   ├── electron/                 # Electron main process
│   │   ├── main.js              # Entry point, IPC handlers
│   │   └── preload.js           # Security bridge
│   ├── src/                     # React application
│   │   ├── components/          # UI components
│   │   │   ├── Dashboard.js     # Main dashboard
│   │   │   ├── MinerConfig.js   # XMRig config
│   │   │   ├── NanominerConfig.js  # Nanominer config
│   │   │   ├── MinerConsole.js  # Output display
│   │   │   └── SystemInfoCard.js   # System stats
│   │   ├── hooks/               # Custom React hooks
│   │   │   └── useSystemInfo.js # System data hooks
│   │   ├── utils/               # Helper functions
│   │   │   └── hashrate.js      # Hashrate formatting
│   │   ├── App.js               # Root component
│   │   └── index.js             # React entry
│   ├── scripts/                 # Utility scripts
│   │   ├── download-miners.js   # Auto-download miners
│   │   └── generate-mining-config.js  # Wallet generator
│   ├── miners/                  # Miner binaries (gitignored)
│   │   ├── xmrig/
│   │   └── nanominer/
│   ├── public/                  # Static assets
│   └── package.json             # Dependencies
└── docs/                        # Documentation
    ├── README.md                # Docs index
    ├── architecture.md          # Technical architecture
    ├── installation.md          # Install guide
    ├── user-guide.md            # User manual
    ├── api-reference.md         # API docs
    ├── mining-configuration.md  # Mining setup
    ├── troubleshooting.md       # Issue resolution
    ├── development.md           # Dev guide
    ├── quick-start.md           # Quick start
    └── faq.md                   # FAQ
```

## 🎨 Architecture Overview

### Three-Layer Architecture

```
┌─────────────────────────────────────────┐
│         Presentation Layer              │
│  (React Components + UI)                │
│  - Dashboard, Config, Console           │
└─────────────────┬───────────────────────┘
                  │ IPC
┌─────────────────▼───────────────────────┐
│         Application Layer               │
│  (Electron Main Process)                │
│  - Process Management                   │
│  - System Monitoring                    │
│  - Configuration                        │
└─────────────────┬───────────────────────┘
                  │ spawn/exec
┌─────────────────▼───────────────────────┐
│         Mining Layer                    │
│  (External Processes)                   │
│  - XMRig (CPU)                         │
│  - Nanominer (GPU)                     │
└─────────────────────────────────────────┘
```

### Data Flow

**User Action → IPC → Process Management → Miner Binary → Pool**

**Miner Output → stdout → IPC → React State → UI Update**

## 🔑 Key Features

### 1. Multi-Miner Support
- Simultaneous CPU and GPU mining
- Independent configuration per miner
- Individual start/stop control
- Bulk operations (start/stop all)

### 2. Real-Time Monitoring
- Live hashrate tracking
- System resource usage (CPU, RAM, GPU)
- Temperature monitoring
- Console output streaming

### 3. User-Friendly Configuration
- Form-based configuration (no CLI)
- Visual CPU usage slider
- Per-GPU power controls
- Configuration persistence

### 4. System Information
- Hardware detection
- Multi-GPU support
- CPU/GPU temperature
- VRAM usage tracking

### 5. Cross-Platform
- Works on Linux, Windows, macOS
- Platform-specific optimizations
- Automatic binary selection

## 🔐 Security Model

### Context Isolation
- **Enabled**: Prevents renderer from accessing Node.js APIs
- **Preload Script**: Controlled API exposure via contextBridge
- **No Remote Module**: All IPC through defined channels

### Process Sandboxing
- Miner processes run as isolated child processes
- No direct filesystem access from renderer
- Wallet/config data stays local

### Data Privacy
- ✅ No telemetry or analytics
- ✅ No external API calls (except to pools)
- ✅ Configuration stored locally
- ✅ No wallet private keys stored

## 📈 Performance Characteristics

### Resource Usage
| Component | RAM | CPU | Notes |
|-----------|-----|-----|-------|
| Electron App | 100-150 MB | <1% | When not mining |
| XMRig | 50-100 MB | 10-100% | Configurable |
| Nanominer | 100-200 MB | <5% | Per GPU overhead |
| System Monitoring | Minimal | <0.1% | Cached reads |

### Optimization Strategies
1. **Background Polling**: System stats updated every 10s, cached
2. **Lazy Loading**: GPU info fetched only when needed
3. **Local Storage**: Config cached to avoid repeated IPC
4. **Debouncing**: Console updates throttled for performance

## 🧪 Testing Strategy

### Current Testing
- **Manual Testing**: Comprehensive test cases
- **Platform Testing**: Linux (Ubuntu), Windows 10/11
- **Hardware Testing**: Various CPU/GPU combinations

## 🤝 Contribution Guidelines

### How to Contribute
1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request
5. Respond to review feedback

### Coding Standards
- ESLint for JavaScript linting
- Prettier for code formatting
- Functional components with hooks
- Clear, descriptive variable names
- Comments for complex logic

### Documentation Requirements
- Update relevant docs for features
- Add JSDoc comments for functions
- Update CHANGELOG.md
- Include screenshots for UI changes

## 📊 Project Metrics

### Codebase Statistics
- **Total Lines**: ~7,000 LOC (excluding node_modules)
- **JavaScript/React**: ~5,000 LOC
- **CSS**: ~1,500 LOC
- **Configuration**: ~500 LOC

### Component Breakdown
- **Electron Main**: ~750 LOC
- **React Components**: ~2,500 LOC
- **Hooks & Utils**: ~500 LOC
- **Scripts**: ~500 LOC

## 🔧 Build & Deployment

### Development Build
```bash
npm start
# React dev server + Electron
# Hot reload enabled
# DevTools open
```

### Production Build
```bash
npm run build              # Build React
npm run build:electron     # Package Electron
```

### Distribution
- **Linux**: AppImage (portable), DEB (package)
- **Windows**: NSIS installer
- **macOS**: DMG disk image

### Release Process
1. Update version in package.json
2. Update CHANGELOG.md
3. Build for all platforms
4. Test installers
5. Create GitHub release
6. Upload binaries
7. Announce release

## 🌍 Community & Support

### Resources
- **Documentation**: `/docs` folder
- **Issues**: GitHub issue tracker
- **Discussions**: GitHub discussions
- **Social Media**: (To be determined)

### Getting Help
1. Check documentation
2. Search existing issues
3. Ask in discussions
4. Open new issue if needed

### Reporting Bugs
- Use issue template
- Include system info
- Provide reproduction steps
- Attach logs/screenshots

## 📜 License & Legal

### Third-Party Software
- **XMRig**: GPL-3.0 License
- **Nanominer**: Check official terms
- **Electron**: MIT License
- **React**: MIT License

### Disclaimer
Mining cryptocurrency consumes electricity and may generate heat. Users are responsible for:
- Understanding local regulations
- Managing hardware safely
- Calculating profitability
- Securing wallet addresses

MineMaster is provided "as-is" without warranty.

## 📞 Contact & Links

### Project Links
- **Repository**: (To be added)
- **Documentation**: `/docs`
- **Releases**: (To be added)
- **Issues**: (To be added)

### Related Projects
- **XMRig**: https://github.com/xmrig/xmrig
- **Nanominer**: https://github.com/nanopool/nanominer
- **Electron**: https://www.electronjs.org/
- **React**: https://react.dev/

## 🎓 Learning Resources

### For Users
- [Quick Start Guide](quick-start.md)
- [User Guide](user-guide.md)
- [Mining Configuration](mining-configuration.md)
- [FAQ](faq.md)

### For Developers
- [Development Guide](development.md)
- [Architecture Overview](architecture.md)
- [API Reference](api-reference.md)

### External Resources
- Electron Documentation
- React Documentation
- XMRig Documentation
- Cryptocurrency Mining Guides

---

## 📝 Document Updates

This overview will be updated as the project evolves.

**Last Updated**: January 2026
**Version**: 1.0.0
**Maintainers**: Project Team
