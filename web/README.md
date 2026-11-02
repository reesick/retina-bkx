# Retinitry web

React 18 + Vite + TypeScript (strict). Spec: `docs/05_UI_UX.md`, contract: `docs/04_API.md`.

```powershell
npm install
npm run dev        # http://localhost:5173, proxies /api -> http://127.0.0.1:8765
npm run dev:mock   # in-browser mock API (VITE_MOCK=1 via .env.mock), no server needed
npm run build      # -> web/dist (served by FastAPI at /, SPA fallback to index.html)
npm run build:mock # mock build, for demos without the server
npm run preview    # serve dist on 5173
npm run typecheck
npm run test       # vitest: Le Grand optics + fundus->globe projection
```

Layout: `src/api` (types, client, sse, mock, mockPolicy, fixtures, hooks), `src/components` (design system),
`src/three` (procedural eye, shaders, projection, optics view, lab scenes, scan shader), `src/pages`,
`src/lib` (sound, optics, format, store, fundusArt, va, sha256).

No runtime network access: Inter is bundled, the environment map is generated (RoomEnvironment + PMREM),
all textures are procedural or come from same-origin `/api`. Add `?lowpower=1` to any URL to start with
post-processing off (it also switches off automatically below 45 fps).
