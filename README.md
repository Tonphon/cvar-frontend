# CVaR Portfolio Optimizer UI (Vite + React + Tailwind)

## Overview

This repository contains the Vite + React + Tailwind frontend UI for the CVaR Portfolio Optimizer project. Users upload a portfolio CSV, edit optimization config, run the optimizer through the backend API, then view plots and download artifacts. Optional LLM memo can be displayed if enabled on the backend.

**Backend API (required):** https://github.com/Tonphon/cvar-fastapi

## Requirements

- Node.js 18+ recommended
- Running backend API (local or remote)

## Setup

### Clone and Install Dependencies

```bash
git clone https://github.com/Tonphon/cvar-frontend.git
cd cvar-frontend
npm install
```

### Configure Backend URL

Create a file named `.env` in the project root:

```env
VITE_API_BASE=http://127.0.0.1:8000
```

**Note:** Restart the dev server after changing `.env`.

## Run (Local)

```bash
npm run dev
```

## Usage

### Start backend (example):
```bash
cd cvar-fastapi
uvicorn app.main:app --reload
```

### Start frontend:
```bash
cd cvar-frontend
npm run dev
```

Open the Vite URL (e.g., http://localhost:5173), upload a portfolio CSV, adjust config, and run.

## Input CSV Format

```csv
date,AAPL.US,MSFT.US,SPY.US,GLD.US
2025-12-12,0.25,0.25,0.40,0.10
```

## API Calls Used by the UI

Relative to `VITE_API_BASE`:

- `POST /api/runs` - Upload portfolio + config
- `GET /api/runs/{run_id}` - Poll run status
- `GET /api/runs/{run_id}/summary` - Summary data
- `GET /api/runs/{run_id}/memo` - Memo (optional)
- `GET /runs/{run_id}/...` - Plots and artifact downloads

## Build

```bash
npm run build
```

**Output directory:** `dist/`

### Preview the build locally:
```bash
npm run preview
```
