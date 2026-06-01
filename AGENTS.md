# Repository Guidelines

## Project Structure & Module Organization

`wmcssh` is a Tauri 2 desktop SSH client with a React/TypeScript frontend and Rust backend. Frontend code lives in `src/`: app bootstrap in `src/app/`, feature UI in `src/features/`, Tauri API wrappers in `src/services/tauri/`, stores in `src/stores/`, and shared types in `src/types/`.

Backend code lives in `src-tauri/src/`: Tauri commands in `commands/`, API contracts in `contracts/`, persistence in `repositories/` and `db/`, business logic in `services/`, credential storage in `secrets/`, and SSH sessions in `ssh/`. SQLite migrations are in `src-tauri/migrations/`. Static fonts are in `public/fonts/`; do not edit generated `dist/` or `src-tauri/target/` output.

## Build, Test, and Development Commands

- `npm install`: install frontend and Tauri dependencies.
- `npm run dev`: start the Vite frontend dev server.
- `npm run tauri dev`: run the desktop app locally.
- `npm run build`: type-check with `tsc`, then build the Vite frontend.
- `cd src-tauri && cargo check`: check Rust compilation quickly.
- `cd src-tauri && cargo test`: run Rust unit tests.
- `npm run build:linux:amd64` / `npm run build:windows:amd64`: create Tauri packages.

## Coding Style & Naming Conventions

TypeScript is strict and uses React JSX. Keep Tauri invocations in `src/services/tauri/`, shared DTOs in `src/types/`, and UI state in components or stores. Use `PascalCase` for components, `camelCase` for functions and variables, and descriptive feature directories such as `file-transfer`.

Rust uses edition 2021 conventions: `snake_case` modules/functions, typed contracts, and existing `thiserror`/`anyhow` patterns. Run `cargo fmt` before submitting Rust changes.

## Testing Guidelines

Rust tests live in `src-tauri/src/tests.rs`; add focused tests near backend service, repository, and contract changes. Run `cargo test` before backend PRs and `npm run build` before frontend PRs. No frontend test runner is configured, so validate UI changes through `npm run tauri dev` and note manual coverage in the PR.

## Commit & Pull Request Guidelines

This checkout does not include Git history, so use short imperative commits such as `Add file transfer refresh state` or `Fix SSH reconnect cleanup`. Keep commits scoped to one behavior or refactor.

PRs should include a summary, affected areas, commands run, and manual verification. Include screenshots or recordings for visible UI changes, and link related issues or docs when applicable.

## Security & Configuration Tips

Do not store plaintext passwords or private-key passphrases in SQLite or committed files. Follow the `password_ref` / `passphrase_ref` pattern and local secret store behavior. Avoid committing local app data, packaged binaries, or generated `target/` artifacts.
