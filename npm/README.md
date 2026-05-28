atlas-agent
===========

AI Coding Assistant CLI with leader/executor architecture.

Install
-------

```bash
npm install -g atlas-agent
```

The postinstall script downloads the platform-specific binary from your
configured artifact server (`ATLAS_INSTALL_URL`).

Configure
---------

```bash
export ATLAS_AUTH_TOKEN="your-token"
export ATLAS_BASE_URL="http://your-proxy:port/v1"
atlas-agent
```

See https://github.com/hyhy2001/atlas-agent for full docs.
