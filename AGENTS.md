# Repository Guidelines

本文档约束在本仓库内工作的开发者和自动化代理。开始修改前，先阅读
[`docs/07-项目现状.md`](docs/07-项目现状.md)，并以实际代码、数据库迁移和 Tauri
配置为最终依据；较早的设计文档可能描述的是规划状态。

## Project Structure & Module Organization

`wmcssh` is a Tauri 2 desktop SSH client with a React/TypeScript frontend and Rust backend. Frontend code lives in `src/`: app bootstrap and the custom title bar in `src/app/`, feature UI in `src/features/`, Tauri API wrappers in `src/services/tauri/`, stores in `src/stores/`, and shared types in `src/types/`.

Backend code lives in `src-tauri/src/`: Tauri commands in `commands/`, API contracts in `contracts/`, persistence in `repositories/` and `db/`, business logic in `services/`, encrypted credential storage in `secrets/`, and SSH/SFTP sessions in `ssh/`. SQLite migrations are in `src-tauri/migrations/`. Static fonts are in `public/fonts/`. Release automation lives in `.github/workflows/`.

Do not hand-edit generated `dist/`, `src-tauri/target/`, or Tauri-generated schema output. Do not commit local databases, logs, installer artifacts, or other machine-local state.

## Build, Test, and Development Commands

- `npm install`: install frontend and Tauri dependencies.
- `npm run dev`: start the Vite frontend dev server.
- `npm run tauri dev`: run the desktop app locally.
- `npm run build`: type-check with `tsc`, then build the Vite frontend.
- `cd src-tauri && cargo check`: check Rust compilation quickly.
- `cd src-tauri && cargo test`: run Rust unit tests.
- `cd src-tauri && cargo fmt --check`: verify Rust formatting.
- `npm run build:linux:amd64` / `npm run build:windows:amd64`: create Tauri packages.

Use `npm run tauri dev` for desktop behavior. `npm run dev` only exercises the web frontend and cannot validate native commands, the credential vault, SSH/SFTP, window dragging, or native dialogs.

## Coding Style & Naming Conventions

TypeScript is strict and uses React JSX. Keep Tauri invocations in `src/services/tauri/`, shared DTOs in `src/types/`, and UI state in components or stores. Use `PascalCase` for components, `camelCase` for functions and variables, and descriptive feature directories such as `file-transfer`.

Rust uses edition 2021 conventions: `snake_case` modules/functions, typed contracts, and existing `thiserror`/`anyhow` patterns. Run `cargo fmt` before submitting Rust changes.

Preserve the current architectural boundaries:

- React components must call typed wrappers instead of invoking Tauri commands directly.
- High-frequency terminal output must be written through the terminal registry, not copied into React state.
- SSH and file-transfer session ownership belongs to the Rust session managers; frontend tabs only track their identifiers and presentation state.
- New persistent data requires a forward-only SQLite migration. Never rewrite a migration that may already have run.
- Color, typography, and layout tokens should remain centralized; avoid scattering one-off values across components.

## Testing Guidelines

Rust tests live both in `src-tauri/src/tests.rs` and alongside their modules. Add focused tests near backend service, repository, contract, migration, and parser changes. Run `cargo test` before backend PRs and `npm run build` before frontend PRs.

No frontend test runner is currently configured. Validate affected desktop flows with `npm run tauri dev`, especially the custom title bar, quick connect, context-menu focus behavior, terminal input/output and resize, vault lock/unlock, and recursive file transfers. Record manual coverage in the PR.

## Commit & Pull Request Guidelines

Use short imperative commits such as `Add file transfer refresh state` or `Fix SSH reconnect cleanup`. Keep commits scoped to one behavior or refactor. Inspect the worktree before editing and preserve unrelated user changes; never include generated packages or local application data in a commit.

PRs should include a summary, affected areas, commands run, and manual verification. Include screenshots or recordings for visible UI changes, and link related issues or docs when applicable.

## Security & Configuration Tips

Do not store plaintext passwords, private-key passphrases, or the vault master password in SQLite, logs, frontend stores, or committed files. Host rows store only `password_ref` / `passphrase_ref` identifiers; secret values belong in the encrypted vault and transient connection credentials must remain memory-only unless the user explicitly chooses to remember them.

Do not bypass vault initialization/unlock checks, weaken the current Argon2id/XChaCha20-Poly1305 flow, or add credentials to DTO debug output. Treat migration from the legacy plaintext secret file as compatibility code, not as an approved storage path.

## Documentation Maintenance

`docs/07-项目现状.md` is the current project-wide capability and limitation snapshot. Update it whenever a change materially affects product behavior, architecture, storage/security, supported platforms, build/release flow, or known limitations. Keep detailed topic documents focused on design and contracts rather than duplicating status claims in multiple places.
